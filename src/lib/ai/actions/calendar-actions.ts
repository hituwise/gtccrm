import type { SupabaseClient } from '@supabase/supabase-js';
import {
  loadCalendarConfig,
  executeDemoBooking,
  rescheduleDemoBooking,
} from '@/lib/calendar/booking-coordinator';
import {
  checkGoogleCalendarAvailability,
  getGoogleCalendarAvailableSlots,
  type AvailableSlotResult,
} from '@/lib/calendar/google-calendar';
import {
  parseBookingSlot,
  formatBookingDateTime,
} from '@/lib/calendar/date-parser';
import { logAiAction } from './action-logger';
import { applyContactTag, updateLeadTemperature } from './tag-service';
import { applyScoringSignals } from './scoring-service';
import { createInternalCrmNote, assignLeadToTeam } from './crm-service';
import {
  type ProductKey,
  type ProductActionConfig,
  type CalendarActionResult,
  DEFAULT_PRODUCT_CONFIGS,
} from './types';

export interface CalendarActionContext {
  db: SupabaseClient;
  accountId: string;
  contactId: string;
  conversationId: string;
  configOwnerUserId?: string;
  productKey?: ProductKey;
  productConfig?: ProductActionConfig;
  preferredTimeText: string;
  email?: string | null;
  childAge?: number | null;
  customerName?: string;
  timezone?: string;
  referenceDate?: Date;
  existingBookingId?: string;
}

/**
 * Checks if a requested slot is available in Google Calendar.
 */
export async function executeCheckAvailability(
  context: CalendarActionContext,
): Promise<{
  available: boolean;
  startTime: string;
  endTime: string;
  humanText: string;
  durationMinutes: number;
  conflictReason?: string;
}> {
  const { db, accountId, contactId, conversationId, productKey, productConfig, preferredTimeText, referenceDate, timezone } = context;

  const resolvedConfig = productConfig || (productKey ? DEFAULT_PRODUCT_CONFIGS[productKey] : DEFAULT_PRODUCT_CONFIGS.ABACUS_KIDS);
  const durationMinutes = resolvedConfig.durationMinutes;

  const calConfig = await loadCalendarConfig(db, accountId);
  const tz = timezone || calConfig?.default_timezone || 'Asia/Kolkata';

  const slot = parseBookingSlot(
    preferredTimeText,
    durationMinutes,
    referenceDate || new Date(),
    tz,
    Boolean(referenceDate),
  );

  // If calendar is not connected or inactive, return unavailable so we don't fake availability
  if (!calConfig?.is_active || (!calConfig.service_account_key && !calConfig.oauth_credentials)) {
    return {
      available: false,
      startTime: slot.startTime,
      endTime: slot.endTime,
      humanText: slot.humanText,
      durationMinutes,
      conflictReason: 'Calendar is not connected or active',
    };
  }

  const check = await checkGoogleCalendarAvailability(calConfig, {
    startTime: slot.startTime,
    endTime: slot.endTime,
  });

  await logAiAction({
    db,
    accountId,
    contactId,
    conversationId,
    action: 'CALENDAR_AVAILABILITY_CHECKED',
    details: {
      slotRequested: slot.startTime,
      durationMinutes,
      available: check.available,
      conflictReason: check.conflictReason,
    },
  });

  return {
    available: check.available,
    startTime: slot.startTime,
    endTime: slot.endTime,
    humanText: slot.humanText,
    durationMinutes,
    conflictReason: check.conflictReason,
  };
}

/**
 * Retrieves actual free slots on Google Calendar for a given day.
 * NEVER hallucinates or invents slots.
 */
export async function executeGetAvailableSlots(
  context: CalendarActionContext,
  targetDate: string | Date,
  count: number = 3,
): Promise<AvailableSlotResult[]> {
  const { db, accountId, productKey, productConfig, timezone } = context;
  const resolvedConfig = productConfig || (productKey ? DEFAULT_PRODUCT_CONFIGS[productKey] : DEFAULT_PRODUCT_CONFIGS.ABACUS_KIDS);

  const calConfig = await loadCalendarConfig(db, accountId);
  if (!calConfig) {
    return [];
  }

  return getGoogleCalendarAvailableSlots(calConfig, {
    targetDate,
    durationMinutes: resolvedConfig.durationMinutes,
    timezone: timezone || calConfig.default_timezone || 'UTC',
    count,
  });
}

/**
 * Books appointment in Google Calendar, creates database record, tags contact,
 * adds CRM note, and assigns lead.
 * ONLY applies DEMO_BOOKED or CALL_BOOKED upon actual booking success!
 */
export async function executeBookAppointment(
  context: CalendarActionContext,
): Promise<CalendarActionResult> {
  const {
    db,
    accountId,
    contactId,
    conversationId,
    configOwnerUserId,
    productKey = 'ABACUS_KIDS',
    productConfig,
    preferredTimeText,
    email,
    childAge,
    customerName,
    timezone,
  } = context;

  if (!email) {
    return {
      action: 'book_appointment',
      success: false,
      error: 'missing_email',
    };
  }

  const resolvedConfig = productConfig || DEFAULT_PRODUCT_CONFIGS[productKey];
  const duration = resolvedConfig.durationMinutes;
  const title = `${resolvedConfig.appointmentType}: ${customerName || 'Customer'}`;

  try {
    const calConfig = await loadCalendarConfig(db, accountId);
    const tz = timezone || calConfig?.default_timezone || 'Asia/Kolkata';

    const bookingResult = await executeDemoBooking({
      db,
      accountId,
      contactId,
      conversationId,
      configOwnerUserId,
      email,
      customerName,
      childAge,
      preferredTimeText,
      bookedBy: 'ai',
      manualTitle: title,
      manualDuration: duration,
      sendWhatsAppConfirmation: false, // AI Agent coordinates response message
    });

    // GOLDEN RULE: Must verify booking success AND real external event ID
    if (!bookingResult.success || !bookingResult.booking || !bookingResult.booking.google_event_id) {
      await logAiAction({
        db,
        accountId,
        contactId,
        conversationId,
        action: 'APPOINTMENT_BOOKING_FAILED',
        details: { error: bookingResult.error, email, preferredTimeText, externalEventIdMissing: !bookingResult.booking?.google_event_id },
      });

      return {
        action: 'book_appointment',
        success: false,
        error: bookingResult.error || 'Google Calendar event creation failed — no external event ID returned',
      };
    }

    const extEventId = bookingResult.booking.google_event_id;

    // 1. Tag with DEMO_BOOKED or CALL_BOOKED
    const bookingTag = resolvedConfig.ctaType === 'Call' ? 'CALL_BOOKED' : 'DEMO_BOOKED';
    await applyContactTag({
      db,
      accountId,
      contactId,
      conversationId,
      tagName: bookingTag,
      color: '#10B981',
    });

    // 2. Set lead temperature to HOT_LEAD
    await updateLeadTemperature({
      db,
      accountId,
      contactId,
      conversationId,
      temperature: 'hot',
    });

    // 3. Update lead score (+25 for booking)
    await applyScoringSignals({
      db,
      accountId,
      contactId,
      conversationId,
      newSignals: ['books_demo_or_call'],
      explicitTemperature: 'hot',
    });

    // 4. Create internal CRM milestone note with external event ID
    const formattedDate = formatBookingDateTime(bookingResult.booking.start_time, tz);
    const detailParts: string[] = [`Slot: ${formattedDate}`, `Duration: ${duration} mins`];
    if (childAge) detailParts.push(`Child Age: ${childAge}`);
    if (bookingResult.booking.meet_link) detailParts.push(`Google Meet: ${bookingResult.booking.meet_link}`);

    await createInternalCrmNote({
      db,
      accountId,
      contactId,
      conversationId,
      userId: configOwnerUserId,
      productName: resolvedConfig.appointmentType,
      customerType: childAge ? 'Parent' : 'Customer',
      mainRequirement: childAge ? `Abacus program for ${childAge}-year-old child` : resolvedConfig.appointmentType,
      importantInfo: `${detailParts.join(', ')}. External event ID: ${extEventId}`,
      bookingStatus: 'Confirmed & Calendar Scheduled',
      nextAction: 'Attend session / admissions onboarding',
    });

    // 5. Assign lead to product team
    await assignLeadToTeam({
      db,
      accountId,
      conversationId,
      contactId,
      productKey,
      targetAgentId: resolvedConfig.assignedAgentId,
      teamName: resolvedConfig.teamName,
    });

    // 6. Log audit action
    await logAiAction({
      db,
      accountId,
      contactId,
      conversationId,
      action: 'APPOINTMENT_BOOKED',
      details: {
        bookingId: bookingResult.booking.id,
        externalEventId: extEventId,
        title,
        startTime: bookingResult.booking.start_time,
        meetLink: bookingResult.booking.meet_link,
      },
    });

    return {
      action: 'book_appointment',
      success: true,
      booked: true,
      bookingId: bookingResult.booking.id,
      meetLink: bookingResult.booking.meet_link,
    };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[calendar-actions] executeBookAppointment error:', message);

    await logAiAction({
      db,
      accountId,
      contactId,
      conversationId,
      action: 'APPOINTMENT_BOOKING_FAILED',
      details: { error: message },
    });

    return {
      action: 'book_appointment',
      success: false,
      error: message,
    };
  }
}

/**
 * Reschedules an existing confirmed booking to a new requested time.
 */
export async function executeRescheduleAppointment(
  context: CalendarActionContext & { existingBookingId: string },
): Promise<CalendarActionResult> {
  const {
    db,
    accountId,
    contactId,
    conversationId,
    configOwnerUserId,
    productKey = 'ABACUS_KIDS',
    productConfig,
    preferredTimeText,
    existingBookingId,
    customerName,
    timezone,
    childAge,
    referenceDate,
  } = context;

  const resolvedConfig = productConfig || DEFAULT_PRODUCT_CONFIGS[productKey];
  const duration = resolvedConfig.durationMinutes;

  const calConfig = await loadCalendarConfig(db, accountId);
  const tz = timezone || calConfig?.default_timezone || 'Asia/Kolkata';

  const slot = parseBookingSlot(
    preferredTimeText,
    duration,
    referenceDate || new Date(),
    tz,
    Boolean(referenceDate),
  );

  try {
    const res = await rescheduleDemoBooking({
      db,
      accountId,
      contactId,
      bookingId: existingBookingId,
      newStartTime: slot.startTime,
      newEndTime: slot.endTime,
      timezone: tz,
      configOwnerUserId,
      conversationId,
    });

    if (!res.success || !res.booking) {
      await logAiAction({
        db,
        accountId,
        contactId,
        conversationId,
        action: 'APPOINTMENT_BOOKING_FAILED',
        details: { error: res.error, existingBookingId, preferredTimeText },
      });

      return {
        action: 'book_appointment',
        success: false,
        error: res.error || 'Rescheduling failed',
      };
    }

    const formattedDate = formatBookingDateTime(slot.startTime, tz);
    const extId = res.booking.google_event_id || 'N/A';

    await createInternalCrmNote({
      db,
      accountId,
      contactId,
      conversationId,
      userId: configOwnerUserId,
      productName: resolvedConfig.appointmentType,
      customerType: childAge ? 'Parent' : 'Customer',
      mainRequirement: `Rescheduled demo to ${formattedDate}`,
      importantInfo: `Rescheduled to ${formattedDate}. Duration: ${duration} mins. External event ID: ${extId}`,
      bookingStatus: 'Rescheduled & Calendar Updated',
      nextAction: 'Attend rescheduled session',
    });

    await logAiAction({
      db,
      accountId,
      contactId,
      conversationId,
      action: 'APPOINTMENT_BOOKED',
      details: {
        bookingId: res.booking.id,
        rescheduled: true,
        startTime: slot.startTime,
        externalEventId: extId,
        meetLink: res.booking.meet_link,
      },
    });

    return {
      action: 'book_appointment',
      success: true,
      booked: true,
      bookingId: res.booking.id,
      meetLink: res.booking.meet_link,
    };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[calendar-actions] executeRescheduleAppointment error:', message);
    return {
      action: 'book_appointment',
      success: false,
      error: message,
    };
  }
}
