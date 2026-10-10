import type { SupabaseClient } from '@supabase/supabase-js';
import {
  type ProductKey,
  type ProductActionConfig,
  type ActionPipelineResult,
  type CalendarActionResult,
  type TenantProductConfig,
  type MeetingLinkMode,
  DEFAULT_PRODUCT_CONFIGS,
} from './types';
import { analyzeCustomerIntent } from './intent-detector';
import { applyContactTag } from './tag-service';
import { applyScoringSignals } from './scoring-service';
import { createInternalCrmNote, assignLeadToTeam } from './crm-service';
import {
  executeCheckAvailability,
  executeGetAvailableSlots,
  executeBookAppointment,
  executeRescheduleAppointment,
} from './calendar-actions';
import { findActiveBookingForContact, loadCalendarConfig } from '@/lib/calendar/booking-coordinator';
import { getTenantProducts, getTenantBusinessProfile } from '@/lib/products/tenant-products';
import {
  detectScheduleQuery,
  formatScheduleResponse,
  extractConversationCollectedFields,
} from '@/lib/ai/conversation-state';
import { logAiAction } from './action-logger';
import { formatBookingDateTime, hasDateSpecified, hasTimeSpecified } from '@/lib/calendar/date-parser';
import type { ChatMessage, AiConfig } from '@/lib/ai/types';

export interface RunAiPipelineArgs {
  db: SupabaseClient;
  accountId: string;
  conversationId: string;
  contactId: string;
  configOwnerUserId?: string;
  inboundText: string;
  messages: ChatMessage[];
  aiConfig?: AiConfig | null;
  productConfigs?: Record<ProductKey, ProductActionConfig> | TenantProductConfig[];
  contactRecord?: {
    id: string;
    name?: string | null;
    email?: string | null;
    phone?: string | null;
    lead_score?: number;
    lead_temperature?: string | null;
  };
}

/**
 * Strips raw internal command strings, tags, and notes to protect customer-facing output.
 */
export function sanitizeCustomerResponse(text: string): string {
  let cleaned = text;

  // Strip potential leaking tags or pseudo-commands
  cleaned = cleaned.replace(/ADD_TAG:\s*[A-Z_]+/gi, '');
  cleaned = cleaned.replace(/REMOVE_TAG:\s*[A-Z_]+/gi, '');
  cleaned = cleaned.replace(/LEAD_SCORE:\s*\d+/gi, '');
  cleaned = cleaned.replace(/LEAD_TEMP(?:ERATURE)?:\s*[a-z_]+/gi, '');
  cleaned = cleaned.replace(/ASSIGN_TO:\s*[a-z0-9_-]+/gi, '');
  cleaned = cleaned.replace(/BOOK_CALENDAR:\s*(?:true|false)/gi, '');
  cleaned = cleaned.replace(/NOTE:\s*.*(?:\n|$)/gi, '');
  cleaned = cleaned.replace(/INTERNAL_NOTE:\s*.*(?:\n|$)/gi, '');
  cleaned = cleaned.replace(/\[\[ACTION:[^\]]+\]\]/gi, '');

  return cleaned.trim();
}

export function formatDemoBookingConfirmation(args: {
  appointmentType: string;
  isoStartTime: string;
  durationMinutes: number;
  timezone?: string;
  meetLink?: string | null;
  meetingMode?: MeetingLinkMode;
  isReschedule?: boolean;
}): string {
  const tz = args.timezone || 'Asia/Kolkata';
  const d = new Date(args.isoStartTime);

  const day = new Intl.DateTimeFormat('en-US', { timeZone: tz, day: 'numeric' }).format(d);
  const weekday = new Intl.DateTimeFormat('en-US', { timeZone: tz, weekday: 'long' }).format(d);
  const month = new Intl.DateTimeFormat('en-US', { timeZone: tz, month: 'long' }).format(d);
  const time = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  }).format(d);

  const tzLabel = tz === 'Asia/Kolkata' ? 'IST' : tz;
  const verb = args.isReschedule ? 'has been rescheduled' : 'is booked';

  let msg =
    `Perfect 😊 Your ${args.appointmentType} ${verb}!\n\n` +
    `📅 ${weekday}, ${day} ${month}\n` +
    `⏰ ${time} ${tzLabel}\n` +
    `⏱️ ${args.durationMinutes} minutes`;

  const mode = args.meetingMode || 'GOOGLE_MEET';

  if (args.meetLink && args.meetLink.startsWith('http')) {
    if (mode === 'ZOOM') {
      msg += `\n📹 Zoom: ${args.meetLink}`;
    } else if (mode === 'STATIC_MEETING_LINK') {
      msg += `\n🔗 Meeting Link: ${args.meetLink}`;
    } else {
      msg += `\n💻 Google Meet: ${args.meetLink}`;
    }
  } else if (mode === 'NONE' || mode === 'MANUAL_FOLLOW_UP' || !args.meetLink) {
    msg += `\n📞 We will call you directly at the scheduled time.`;
  }

  msg += `\n\nSee you there! 🎉`;
  return msg;
}

/**
 * Core Action Pipeline: executes intent recognition, CRM actions, calendar interactions,
 * and generates grounded, sanitized customer responses.
 */
export async function runAiActionPipeline(
  args: RunAiPipelineArgs,
): Promise<ActionPipelineResult> {
  const {
    db,
    accountId,
    conversationId,
    contactId,
    configOwnerUserId,
    inboundText,
    messages,
    productConfigs,
    contactRecord,
  } = args;

  const tagsAdded: string[] = [];
  const tagsRemoved: string[] = [];

  // Resolve Tenant Product Catalogue
  let resolvedCatalogue: TenantProductConfig[] = [];
  if (Array.isArray(productConfigs)) {
    resolvedCatalogue = productConfigs;
  } else if (productConfigs && Object.keys(productConfigs).length > 0) {
    resolvedCatalogue = Object.values(productConfigs);
  } else {
    resolvedCatalogue = await getTenantProducts(db, accountId, { fallbackToSeedIfGeniplus: true });
  }

  const catalogueMap: Record<string, TenantProductConfig> = {};
  for (const p of resolvedCatalogue) {
    catalogueMap[p.productServiceId] = p;
    if (p.productKey) catalogueMap[p.productKey] = p;
  }

  // 1. Analyze intents, products, signals, dates, and times
  const intents = analyzeCustomerIntent({
    currentText: inboundText,
    messages,
    contactEmail: contactRecord?.email,
    catalogue: resolvedCatalogue.length > 0 ? resolvedCatalogue : undefined,
  });

  // Ambiguity check: If customer's request matches multiple products equally, ask clarifying question
  if (intents.isAmbiguousProduct && intents.clarifyingQuestion) {
    return {
      customerResponse: intents.clarifyingQuestion,
      productKey: intents.products[0],
      tagsAdded,
      tagsRemoved,
      leadTemperature: 'warm',
      leadScore: 10,
      assignedAgentId: null,
      isHandoff: false,
    };
  }

  const primaryProductKey: ProductKey | undefined = intents.products[0];
  const activeProductConfig = primaryProductKey
    ? catalogueMap[primaryProductKey] || DEFAULT_PRODUCT_CONFIGS[primaryProductKey]
    : undefined;

  // 2. Product Tagging (scoped to tenant)
  for (const prodKey of intents.products) {
    const pCfg = catalogueMap[prodKey] || DEFAULT_PRODUCT_CONFIGS[prodKey];
    const tagName = pCfg?.tags?.interestTag || pCfg?.tagName;
    if (tagName) {
      const added = await applyContactTag({
        db,
        accountId,
        contactId,
        conversationId,
        tagName,
        color: '#6366F1',
      });
      if (added) tagsAdded.push(tagName);

      await logAiAction({
        db,
        accountId,
        contactId,
        conversationId,
        action: 'AI_PRODUCT_DETECTED',
        details: { productKey: prodKey, tag: tagName },
      });
    }
  }

  // 3. Stage Tagging (e.g. INTERESTED, DEMO_REQUESTED, etc.)
  for (const stageTag of intents.stageTagsToAdd) {
    const added = await applyContactTag({
      db,
      accountId,
      contactId,
      conversationId,
      tagName: stageTag,
    });
    if (added) tagsAdded.push(stageTag);
  }

  // 4. Lead Scoring & Temperature Classification
  const scoreResult = await applyScoringSignals({
    db,
    accountId,
    contactId,
    conversationId,
    newSignals: intents.signals,
    explicitTemperature: intents.temperature,
  });

  let finalLeadTemperature = scoreResult.temperature;
  let finalLeadScore = scoreResult.newScore;

  // 5. Lead Assignment (if product is identified or high intent)
  let assignedAgentId: string | null = null;
  if (activeProductConfig) {
    const teamName = activeProductConfig.assignmentRules?.teamName || activeProductConfig.teamName || 'General';
    const targetAgentId = activeProductConfig.assignmentRules?.assignedAgentId || activeProductConfig.assignedAgentId;

    assignedAgentId = await assignLeadToTeam({
      db,
      accountId,
      conversationId,
      contactId,
      productKey: activeProductConfig.productKey || activeProductConfig.productServiceId,
      targetAgentId,
      teamName,
    });
  }

  // 6. Handle Human Handoff if requested
  if (intents.isHumanHandoffRequested) {
    await applyContactTag({
      db,
      accountId,
      contactId,
      conversationId,
      tagName: 'HUMAN_HANDOFF',
      color: '#EF4444',
    });

    await logAiAction({
      db,
      accountId,
      contactId,
      conversationId,
      action: 'HUMAN_HANDOFF_TRIGGERED',
      details: { text: inboundText },
    });

    const noteCreated = await createInternalCrmNote({
      db,
      accountId,
      contactId,
      conversationId,
      userId: configOwnerUserId,
      productName: activeProductConfig?.appointmentType || 'General Inquiry',
      customerType: intents.customerType || 'Customer',
      mainRequirement: intents.painPoint || 'Customer requested human representative',
      bookingStatus: 'Handoff to human agent',
      nextAction: 'Agent follow up immediately',
    });

    return {
      customerResponse:
        "I'm connecting you with one of our team members right now. They'll assist you shortly! 😊",
      productKey: primaryProductKey,
      tagsAdded,
      tagsRemoved,
      leadTemperature: scoreResult.temperature,
      leadScore: scoreResult.newScore,
      assignedAgentId,
      crmNoteCreated: noteCreated,
      isHandoff: true,
    };
  }

  // 7. Calendar Interaction (Check Availability, Get Slots, Book Appointment)
  let calendarResult: CalendarActionResult | undefined = undefined;
  let customerResponse = '';
  let crmNoteCreated: string | undefined = undefined;

  // Check if contact already has an active confirmed booking
  const activeBooking = await findActiveBookingForContact(db, accountId, contactId);

  const calConfig = await loadCalendarConfig(db, accountId);
  const effectiveProductConfig =
    activeProductConfig || (resolvedCatalogue.length > 0 ? resolvedCatalogue[0] : undefined);
  const timezone =
    effectiveProductConfig?.timezone || calConfig?.default_timezone || 'Asia/Kolkata';

  // Schedule or Timing Query (answer strictly from tenant schedule, never invent timings)
  if (detectScheduleQuery(inboundText)) {
    const profile = await getTenantBusinessProfile(db, accountId);
    customerResponse = formatScheduleResponse(effectiveProductConfig, profile);
    return {
      customerResponse: sanitizeCustomerResponse(customerResponse),
      productKey: primaryProductKey,
      tagsAdded,
      tagsRemoved,
      leadTemperature: 'warm',
      leadScore: finalLeadScore,
      assignedAgentId,
      isHandoff: false,
    };
  }

  // If no product is configured for this tenant and customer wants to book
  if (!effectiveProductConfig && (intents.isReadyToBook || intents.hasBothDateAndTime || intents.hasOnlyDate)) {
    customerResponse =
      `Thank you for reaching out! Our team will contact you directly to help schedule and confirm your appointment. What day and time work best for you?`;
    return {
      customerResponse: sanitizeCustomerResponse(customerResponse),
      productKey: primaryProductKey,
      tagsAdded,
      tagsRemoved,
      leadTemperature: 'warm',
      leadScore: finalLeadScore,
      assignedAgentId,
      isHandoff: false,
    };
  }

  // Check if product is in self-scheduling BOOKING_PAGE mode
  if (effectiveProductConfig && effectiveProductConfig.meetingMode === 'BOOKING_PAGE' && (intents.isReadyToBook || intents.signals.includes('requests_demo_or_call'))) {
    const pageUrl = effectiveProductConfig.meetingLink || '';
    customerResponse = pageUrl
      ? `You can choose a convenient slot and complete your booking directly on our calendar page here:\n🔗 ${pageUrl}`
      : `Please visit our booking page to select your preferred appointment slot.`;
    return {
      customerResponse: sanitizeCustomerResponse(customerResponse),
      productKey: primaryProductKey,
      tagsAdded,
      tagsRemoved,
      leadTemperature: 'warm',
      leadScore: finalLeadScore,
      assignedAgentId,
      isHandoff: false,
    };
  }

  const isRescheduleScenario =
    Boolean(activeBooking) &&
    Boolean(intents.isSlotCheckOrReschedule || intents.hasOnlyTime || (intents.hasBothDateAndTime && activeBooking));

  const isBookingScenario =
    !isRescheduleScenario &&
    (intents.isReadyToBook ||
      intents.hasBothDateAndTime ||
      (intents.hasOnlyDate && intents.hasOnlyTime));

  if (isRescheduleScenario && activeBooking && effectiveProductConfig) {
    // A. RESCHEDULING SCENARIO: Customer requested an alternative slot or reschedule
    const inheritedDate = new Date(activeBooking.start_time);
    const bookingTz = activeBooking.timezone || timezone;

    const check = await executeCheckAvailability({
      db,
      accountId,
      contactId,
      conversationId,
      productKey: effectiveProductConfig.productKey || effectiveProductConfig.productServiceId,
      productConfig: effectiveProductConfig,
      preferredTimeText: inboundText,
      referenceDate: inheritedDate,
      timezone: bookingTz,
    });

    if (check.available) {
      const reschedRes = await executeRescheduleAppointment({
        db,
        accountId,
        contactId,
        conversationId,
        configOwnerUserId,
        existingBookingId: activeBooking.id,
        productKey: effectiveProductConfig.productKey || effectiveProductConfig.productServiceId,
        productConfig: effectiveProductConfig,
        preferredTimeText: inboundText,
        customerName: contactRecord?.name || 'there',
        timezone: bookingTz,
        referenceDate: inheritedDate,
      });

      calendarResult = reschedRes;

      if (reschedRes.success) {
        const apptName =
          effectiveProductConfig.productKey === 'ABACUS_KIDS'
            ? 'Abacus demo'
            : effectiveProductConfig.appointmentType;
        customerResponse = formatDemoBookingConfirmation({
          appointmentType: apptName,
          isoStartTime: check.startTime,
          durationMinutes: effectiveProductConfig.durationMinutes,
          timezone: bookingTz,
          meetLink: reschedRes.meetLink,
          meetingMode: effectiveProductConfig.meetingMode,
          isReschedule: true,
        });
      } else {
        customerResponse =
          `I couldn't move your appointment to that slot on the calendar. Let me know another time that works for you!`;
      }
    } else {
      const alternatives = await executeGetAvailableSlots(
        {
          db,
          accountId,
          contactId,
          conversationId,
          productKey: effectiveProductConfig.productKey || effectiveProductConfig.productServiceId,
          productConfig: effectiveProductConfig,
          preferredTimeText: inboundText,
          timezone: bookingTz,
        },
        check.startTime,
        3,
      );

      calendarResult = {
        action: 'get_available_slots',
        success: true,
        available: false,
        slots: alternatives,
      };

      if (alternatives.length > 0) {
        const slotsList = alternatives.map((s) => `• ${s.humanText}`).join('\n');
        customerResponse =
          `That specific time is unfortunately booked, but I found these open slots on our calendar:\n\n` +
          `${slotsList}\n\n` +
          `Would any of these work for you?`;
      } else {
        customerResponse =
          `That slot is currently unavailable. Could you let me know another day or time that works for you?`;
      }
    }
  } else if (isBookingScenario && effectiveProductConfig) {
    // B. NEW BOOKING SCENARIO
    let preferredTimeText = inboundText;
    if (!(hasDateSpecified(inboundText) && hasTimeSpecified(inboundText))) {
      const slotMsg = [...messages]
        .reverse()
        .find((m) => m.role === 'user' && (hasDateSpecified(m.content) || hasTimeSpecified(m.content)));
      if (slotMsg) {
        preferredTimeText = slotMsg.content;
      }
    }

    const effectiveEmail = intents.email || contactRecord?.email || activeBooking?.attendee_email;
    const isPlaceholderName = (name?: string | null) =>
      !name || /^(?:parent|customer|there|test|lead|user)$/i.test(name.trim());

    const effectiveName =
      (intents.explicitNameProvided && intents.customerName) ||
      intents.customerName ||
      (contactRecord?.name && !isPlaceholderName(contactRecord.name) ? contactRecord.name : null);

    const hasDate = Boolean(
      intents.requestedDateText ||
      hasDateSpecified(inboundText) ||
      (preferredTimeText && hasDateSpecified(preferredTimeText))
    );
    const hasTime = Boolean(
      intents.requestedTimeText ||
      hasTimeSpecified(inboundText) ||
      (preferredTimeText && hasTimeSpecified(preferredTimeText))
    );

    const reqFields = effectiveProductConfig.requiredFields || ['name', 'date', 'time'];
    const requiresEmail = reqFields.includes('email');
    const requiresName = reqFields.includes('name');

    // Immediately persist customer email so it is never requested repeatedly
    if (effectiveEmail && contactRecord && contactRecord.email !== effectiveEmail) {
      await db
        .from('contacts')
        .update({ email: effectiveEmail, updated_at: new Date().toISOString() })
        .eq('id', contactId);
    }

    if (!hasDate && !hasTime) {
      const ageStr = intents.childAge ? ` for your ${intents.childAge}-year-old child` : '';
      customerResponse =
        `Wonderful 😊 We can arrange a ${effectiveProductConfig.durationMinutes}-minute ${effectiveProductConfig.appointmentType}${ageStr}.\n\n` +
        `What day and time work best for you?`;
    } else if (!hasDate) {
      customerResponse = `Got it! Which day would work best for you?`;
    } else if (!hasTime) {
      customerResponse = `Got it! What time would work best for you?`;
    } else if (requiresEmail && !effectiveEmail) {
      customerResponse = `Great! What is the best email address to send the booking confirmation and invite to?`;
    } else if (requiresName && !effectiveName) {
      customerResponse = `Perfect 😊 What name should I use for the booking?`;
    } else {
      // ALL REQUIRED FIELDS PRESENT: Construct validated booking object & execute
      if (effectiveName && contactRecord && contactRecord.name !== effectiveName) {
        await db
          .from('contacts')
          .update({ name: effectiveName, email: effectiveEmail, updated_at: new Date().toISOString() })
          .eq('id', contactId);
      }

      const check = await executeCheckAvailability({
        db,
        accountId,
        contactId,
        conversationId,
        productKey: effectiveProductConfig.productKey || effectiveProductConfig.productServiceId,
        productConfig: effectiveProductConfig,
        preferredTimeText,
        timezone,
      });

      if (check.available) {
        if (activeBooking) {
          // Reschedule rather than duplicating
          const reschedRes = await executeRescheduleAppointment({
            db,
            accountId,
            contactId,
            conversationId,
            configOwnerUserId,
            existingBookingId: activeBooking.id,
            productKey: effectiveProductConfig.productKey || effectiveProductConfig.productServiceId,
            productConfig: effectiveProductConfig,
            preferredTimeText,
            customerName: effectiveName || contactRecord?.name || 'there',
            timezone,
          });

          calendarResult = reschedRes;

          if (reschedRes.success) {
            const apptName =
              effectiveProductConfig.productKey === 'ABACUS_KIDS'
                ? 'Abacus demo'
                : effectiveProductConfig.appointmentType || effectiveProductConfig.name || 'session';
            customerResponse = formatDemoBookingConfirmation({
              appointmentType: apptName,
              isoStartTime: check.startTime,
              durationMinutes: effectiveProductConfig.durationMinutes,
              timezone,
              meetLink: reschedRes.meetLink,
              meetingMode: effectiveProductConfig.meetingMode,
              isReschedule: true,
            });
          } else {
            customerResponse =
              `I couldn't move your appointment to that slot on the calendar. Let me know another time that works for you!`;
          }
        } else {
          // Book new appointment
          const bookRes = await executeBookAppointment({
            db,
            accountId,
            contactId,
            conversationId,
            configOwnerUserId,
            productKey: effectiveProductConfig.productKey || effectiveProductConfig.productServiceId,
            productConfig: effectiveProductConfig,
            preferredTimeText,
            email: effectiveEmail || null,
            childAge: intents.childAge,
            customerName: effectiveName || undefined,
            timezone,
          });

          calendarResult = bookRes;

          if (bookRes.success) {
            const bookedTag =
              effectiveProductConfig.tags?.bookedTag ||
              (effectiveProductConfig.ctaType === 'Call' ? 'CALL_BOOKED' : 'DEMO_BOOKED');
            tagsAdded.push(bookedTag);
            finalLeadTemperature = 'hot';
            finalLeadScore = Math.min(100, finalLeadScore + 25);

            const apptName =
              effectiveProductConfig.productKey === 'ABACUS_KIDS'
                ? 'Abacus demo'
                : effectiveProductConfig.appointmentType || effectiveProductConfig.name || 'session';
            customerResponse = formatDemoBookingConfirmation({
              appointmentType: apptName,
              isoStartTime: check.startTime,
              durationMinutes: effectiveProductConfig.durationMinutes,
              timezone,
              meetLink: bookRes.meetLink,
              meetingMode: effectiveProductConfig.meetingMode,
            });
          } else if (bookRes.error?.includes('permission is disabled')) {
            const apptName = effectiveProductConfig.appointmentType || effectiveProductConfig.name || 'session';
            customerResponse =
              `Thank you for sharing your details! Our team will reach out directly to schedule and confirm your ${apptName}.`;
          } else {
            customerResponse =
              `I'm having trouble reserving that exact slot on Google Calendar right now. Please let me know another time that works or our team will reach out directly.`;
          }
        }
      } else if (
        check.conflictReason?.includes('permission is disabled') ||
        check.conflictReason?.includes('not connected') ||
        check.conflictReason?.includes('Calendar is not connected')
      ) {
        const apptName = effectiveProductConfig.appointmentType || effectiveProductConfig.name || 'session';
        customerResponse =
          `Thank you for sharing your details! Our team will reach out directly to confirm your ${apptName} for ${check.humanText}.`;
      } else {
        const alternatives = await executeGetAvailableSlots(
          {
            db,
            accountId,
            contactId,
            conversationId,
            productKey: effectiveProductConfig.productKey || effectiveProductConfig.productServiceId,
            productConfig: effectiveProductConfig,
            preferredTimeText,
            timezone,
          },
          check.startTime,
          3,
        );

        calendarResult = {
          action: 'get_available_slots',
          success: true,
          available: false,
          slots: alternatives,
        };

        if (alternatives.length > 0) {
          const slotsList = alternatives.map((s) => `• ${s.humanText}`).join('\n');
          customerResponse =
            `That specific time is unfortunately booked, but I found these open slots on our calendar:\n\n` +
            `${slotsList}\n\n` +
            `Would any of these work for you?`;
        } else {
          customerResponse =
            `That slot is currently unavailable. Could you let me know another day or time that works for you?`;
        }
      }
    }
  } else if (intents.hasOnlyDate && !intents.hasOnlyTime) {
    customerResponse = `Got it! What time would work best for you?`;
  } else if (intents.hasOnlyTime && !intents.hasOnlyDate) {
    customerResponse = `Got it! Which day would you prefer for this?`;
  } else if (intents.signals.includes('asks_payment') || intents.signals.includes('ready_to_join')) {
    // Ready to join / payment intent
    crmNoteCreated = await createInternalCrmNote({
      db,
      accountId,
      contactId,
      conversationId,
      userId: configOwnerUserId,
      productName: activeProductConfig?.appointmentType || 'Program',
      customerType: intents.customerType || 'Customer',
      mainRequirement: intents.painPoint || 'Ready to enroll and pay',
      bookingStatus: 'Payment requested',
      nextAction: 'Provide payment link / invoice details',
    });

    customerResponse =
      `Fantastic! We're excited to have you join us. I'll get the enrollment details and payment link ready for you right now.`;
  } else if (intents.signals.includes('requests_demo_or_call') && activeProductConfig) {
    // Demo or Call requested
    crmNoteCreated = await createInternalCrmNote({
      db,
      accountId,
      contactId,
      conversationId,
      userId: configOwnerUserId,
      productName: activeProductConfig.appointmentType,
      customerType: intents.customerType || 'Customer',
      mainRequirement: intents.painPoint || 'Demo / Call requested',
      bookingStatus: 'Awaiting date & time',
      nextAction: 'Confirm preferred demo slot',
    });

    const isSon = /son/i.test(inboundText);
    const isDaughter = /daughter/i.test(inboundText);
    const relation = isSon ? 'son' : isDaughter ? 'daughter' : 'child';
    const agePart = intents.childAge ? ` for your ${intents.childAge}-year-old ${relation}` : '';
    const apptLabel =
      activeProductConfig.productKey === 'ABACUS_KIDS'
        ? 'Abacus demo'
        : activeProductConfig.appointmentType;

    const hasEmail = Boolean(intents.email || contactRecord?.email);
    customerResponse = hasEmail
      ? `Wonderful! Our ${apptLabel} takes about ${activeProductConfig.durationMinutes} minutes${agePart}. What day and time work best for you?`
      : `Wonderful 😊 We can arrange a ${activeProductConfig.durationMinutes}-minute ${apptLabel}${agePart}. What day and time work best for you?`;
  } else if (primaryProductKey && activeProductConfig) {
    // Product intent detected without immediate booking slot
    crmNoteCreated = await createInternalCrmNote({
      db,
      accountId,
      contactId,
      conversationId,
      userId: configOwnerUserId,
      productName: activeProductConfig.appointmentType,
      customerType: intents.customerType || 'Customer',
      mainRequirement: intents.painPoint || 'Interested in product',
      bookingStatus: 'Initial inquiry',
      nextAction: 'Offer free demo / introductory call',
    });

    if (primaryProductKey === 'ABACUS_KIDS') {
      const ageNote = intents.childAge
        ? `Our Abacus Mental Math program is wonderful for ${intents.childAge}-year-olds!`
        : `Our Abacus program is designed for children aged 5–14.`;
      customerResponse =
        `Absolutely 😊 ${ageNote} Would you like to book a free 45-minute live demo?`;
    } else if (primaryProductKey === 'MAA') {
      customerResponse =
        `Absolutely 😊 MAA helps Abacus academy owners manage students, teachers, fees, leads, and daily operations. Would you like to see a quick demo?`;
    } else if (primaryProductKey === 'LEAD_PILOT') {
      customerResponse =
        `Great! Lead Pilot automates lead capture, WhatsApp follow-ups, and calendar bookings for coaches. Would you like to book a quick demo call?`;
    } else if (primaryProductKey === 'GTC') {
      customerResponse =
        `That's great! Our Teacher Training Course (GTC) equips you with complete training and certification to start your own Abacus classes. Would you like to schedule a quick call with our training advisor?`;
    } else if (primaryProductKey === 'GOLD') {
      customerResponse =
        `Scaling a coaching academy requires predictable lead generation and sales systems. Would you like to schedule a Business Growth Call to review your academy's expansion roadmap?`;
    } else if (primaryProductKey === 'RUBIKS_CUBE') {
      customerResponse =
        `Awesome! Our Rubik's Cube program teaches children how to solve the 3x3 cube step-by-step with speedcubing algorithms. Would you like to book a free demo session?`;
    } else {
      customerResponse =
        `Great! Our ${activeProductConfig.name} is designed to ${activeProductConfig.description || 'help you achieve your goals'}. Would you like to schedule a ${activeProductConfig.durationMinutes}-minute ${activeProductConfig.appointmentType}?`;
    }
  }

  // Fallback to conversational response if not set by action rules
  if (!customerResponse) {
    customerResponse =
      `Thank you for reaching out! How can I best help you today?`;
  }

  // Ensure customer response never contains internal commands or notes
  const sanitizedResponse = sanitizeCustomerResponse(customerResponse);

  return {
    customerResponse: sanitizedResponse,
    productKey: primaryProductKey,
    tagsAdded,
    tagsRemoved,
    leadTemperature: finalLeadTemperature,
    leadScore: finalLeadScore,
    assignedAgentId,
    crmNoteCreated,
    calendarResult,
    isHandoff: false,
  };
}
