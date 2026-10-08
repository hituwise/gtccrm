import type { SupabaseClient } from '@supabase/supabase-js';
import {
  type ProductKey,
  type ProductActionConfig,
  type ActionPipelineResult,
  type CalendarActionResult,
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
} from './calendar-actions';
import { logAiAction } from './action-logger';
import { formatBookingDateTime } from '@/lib/calendar/date-parser';
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
  productConfigs?: Record<ProductKey, ProductActionConfig>;
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
    productConfigs = DEFAULT_PRODUCT_CONFIGS,
    contactRecord,
  } = args;

  const tagsAdded: string[] = [];
  const tagsRemoved: string[] = [];

  // 1. Analyze intents, products, signals, dates, and times
  const intents = analyzeCustomerIntent({
    currentText: inboundText,
    messages,
    contactEmail: contactRecord?.email,
  });

  const primaryProductKey: ProductKey | undefined = intents.products[0];
  const activeProductConfig = primaryProductKey
    ? productConfigs[primaryProductKey] || DEFAULT_PRODUCT_CONFIGS[primaryProductKey]
    : undefined;

  // 2. Product Tagging
  for (const prodKey of intents.products) {
    const pCfg = productConfigs[prodKey] || DEFAULT_PRODUCT_CONFIGS[prodKey];
    if (pCfg?.tagName) {
      const added = await applyContactTag({
        db,
        accountId,
        contactId,
        conversationId,
        tagName: pCfg.tagName,
        color: '#6366F1',
      });
      if (added) tagsAdded.push(pCfg.tagName);

      await logAiAction({
        db,
        accountId,
        contactId,
        conversationId,
        action: 'AI_PRODUCT_DETECTED',
        details: { productKey: prodKey, tag: pCfg.tagName },
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
    assignedAgentId = await assignLeadToTeam({
      db,
      accountId,
      conversationId,
      contactId,
      productKey: activeProductConfig.productKey,
      targetAgentId: activeProductConfig.assignedAgentId,
      teamName: activeProductConfig.teamName,
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

  const isBookingScenario =
    intents.isReadyToBook ||
    intents.hasBothDateAndTime ||
    (intents.hasOnlyDate && intents.hasOnlyTime);

  if (isBookingScenario && activeProductConfig) {
    // A. Check availability for the specified slot
    const check = await executeCheckAvailability({
      db,
      accountId,
      contactId,
      conversationId,
      productKey: activeProductConfig.productKey,
      productConfig: activeProductConfig,
      preferredTimeText: inboundText,
    });

    if (check.available) {
      // Slot is open!
      const effectiveEmail = intents.email || contactRecord?.email;

      if (effectiveEmail) {
        // We have date, time, and email -> BOOK APPOINTMENT IMMEDIATELY!
        const bookRes = await executeBookAppointment({
          db,
          accountId,
          contactId,
          conversationId,
          configOwnerUserId,
          productKey: activeProductConfig.productKey,
          productConfig: activeProductConfig,
          preferredTimeText: inboundText,
          email: effectiveEmail,
          childAge: intents.childAge,
          customerName: contactRecord?.name || 'there',
        });

        calendarResult = bookRes;

        if (bookRes.success) {
          tagsAdded.push(activeProductConfig.ctaType === 'Call' ? 'CALL_BOOKED' : 'DEMO_BOOKED');
          finalLeadTemperature = 'hot';
          finalLeadScore = Math.min(100, finalLeadScore + 25);
          const formattedDateTime = formatBookingDateTime(check.startTime);

          customerResponse =
            `Perfect 😊 Your ${activeProductConfig.appointmentType} is booked!\n\n` +
            `📅 ${formattedDateTime}\n` +
            `⏱️ ${activeProductConfig.durationMinutes} minutes\n` +
            `💻 Live online (Google Meet link sent to ${effectiveEmail})\n\n` +
            `See you there! 🎉`;
        } else {
          // Booking failed gracefully
          customerResponse =
            `I'm having trouble reserving that exact slot right now. I'll help you with the next step, or our team will reach out directly.`;
        }
      } else {
        // Date & time are available, but we need the email to finalize Google Calendar invite!
        const formattedDateTime = formatBookingDateTime(check.startTime);
        customerResponse =
          `Great! ${formattedDateTime} is available for your ${activeProductConfig.durationMinutes}-minute ${activeProductConfig.appointmentType}.\n\n` +
          `What is the best email address to send the Google Calendar invite and Google Meet link to?`;
      }
    } else {
      // Slot is UNAVAILABLE! Retrieve alternative real slots from the calendar.
      const alternatives = await executeGetAvailableSlots(
        {
          db,
          accountId,
          contactId,
          conversationId,
          productKey: activeProductConfig.productKey,
          productConfig: activeProductConfig,
          preferredTimeText: inboundText,
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
  } else if (intents.hasOnlyDate && !intents.hasOnlyTime) {
    // Minimum Question Principle: date provided, ask only for time!
    customerResponse =
      `Got it! What time would work best for you?`;
  } else if (intents.hasOnlyTime && !intents.hasOnlyDate) {
    // Minimum Question Principle: time provided, ask only for day/date!
    customerResponse =
      `Got it! Which day would you prefer for this?`;
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

    customerResponse =
      `Wonderful! Our ${activeProductConfig.appointmentType} takes about ${activeProductConfig.durationMinutes} minutes. What day and time work best for you?`;
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
