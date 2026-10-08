import type { SupabaseClient } from '@supabase/supabase-js';
import type {
  GoogleCalendarConfig,
  CalendarBooking,
  BookingResult,
  BookedBy,
} from '@/types/calendar';
import {
  createGoogleCalendarBooking,
  updateGoogleCalendarBooking,
  type GoogleBookingResult,
} from './google-calendar';
import { parseBookingSlot, formatBookingDateTime } from './date-parser';
import { engineSendText } from '@/lib/flows/meta-send';

const EMAIL_REGEX = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/;

const BOOKING_INTENT_KEYWORDS = [
  'demo',
  'book',
  'call',
  'schedule',
  'appointment',
  'meeting',
  'consultation',
  'slot',
  'ready',
  'session',
  'chat with',
  'speak with',
  'calendar',
  'invite',
  'meet',
];

const EMAIL_REQUEST_PROMPTS = [
  'email',
  'calendar invite',
  'google meet',
  'best email',
  'email address',
  'send the invite',
];

/**
 * Extracts the first valid email address from a string.
 */
export function extractEmailFromText(text: string): string | null {
  const match = text.match(EMAIL_REGEX);
  return match ? match[0].trim().toLowerCase() : null;
}

/**
 * Detects whether the user is expressing readiness/intent to book a demo or call,
 * or if they are replying to an AI prompt requesting their email for a calendar invite.
 */
export function detectBookingIntent(
  currentText: string,
  recentContextTexts: string[] = [],
): boolean {
  const lower = currentText.toLowerCase();

  // If the message has an explicit booking keyword
  const hasKeyword = BOOKING_INTENT_KEYWORDS.some((kw) => lower.includes(kw));
  if (hasKeyword) return true;

  // If the recent context shows the assistant asked for the customer's email for a demo/call
  const lastAssistantText = recentContextTexts
    .slice()
    .reverse()
    .find((t) => typeof t === 'string' && t.trim().length > 0);

  if (lastAssistantText) {
    const lastLower = lastAssistantText.toLowerCase();
    const assistantAskedForEmail = EMAIL_REQUEST_PROMPTS.some((prompt) =>
      lastLower.includes(prompt),
    );
    if (assistantAskedForEmail && extractEmailFromText(currentText)) {
      return true;
    }
  }

  return false;
}

/**
 * Loads the account's Google Calendar configuration.
 */
export async function loadCalendarConfig(
  db: SupabaseClient,
  accountId: string,
): Promise<GoogleCalendarConfig | null> {
  const { data, error } = await db
    .from('google_calendar_configs')
    .select('*')
    .eq('account_id', accountId)
    .maybeSingle();

  if (error) {
    // If table doesn't exist yet, return null safely
    if (error.code === '42P01') return null;
    console.error('[booking-coordinator] loadCalendarConfig error:', error);
    return null;
  }

  return data as GoogleCalendarConfig | null;
}

/**
 * Renders the confirmation message template with booking details.
 */
export function formatConfirmationMessage(
  template: string | null | undefined,
  params: {
    name: string;
    email: string;
    dateTime: string;
    meetLink?: string | null;
    title: string;
    duration?: number;
  },
): string {
  const hasRealMeetLink = Boolean(params.meetLink && params.meetLink.startsWith('http'));

  const defaultTemplate =
    `Perfect 😊 Your {{title}} is booked!\n\n` +
    `📅 {{date_time}}\n` +
    `⏱️ {{duration}} minutes\n` +
    (hasRealMeetLink ? `💻 Google Meet: {{meet_link}}\n` : '') +
    `\nSee you there! 🎉`;

  let rendered = template && template.trim() ? template : defaultTemplate;

  // If template contains meet_link but no real link exists, strip out that line
  if (!hasRealMeetLink) {
    rendered = rendered
      .replace(/^[^\n]*\{\{meet_link\}\}[^\n]*\n?/gm, '')
      .replace(/^[^\n]*Google Meet[^\n]*\n?/gim, '')
      .replace(/^[^\n]*Calendar invite sent to[^\n]*\n?/gim, '');
  }

  rendered = rendered
    .replace(/\{\{name\}\}/g, params.name || 'there')
    .replace(/\{name\}/g, params.name || 'there')
    .replace(/\{\{email\}\}/g, params.email)
    .replace(/\{email\}/g, params.email)
    .replace(/\{\{date_time\}\}/g, params.dateTime)
    .replace(/\{date_time\}/g, params.dateTime)
    .replace(/\{\{duration\}\}/g, String(params.duration || 45))
    .replace(/\{duration\}/g, String(params.duration || 45))
    .replace(/\{\{meet_link\}\}/g, hasRealMeetLink ? params.meetLink! : '')
    .replace(/\{\{title\}\}/g, params.title)
    .replace(/\{title\}/g, params.title);

  return rendered.trim();
}

export interface ExecuteBookingArgs {
  db: SupabaseClient;
  accountId: string;
  contactId: string;
  conversationId?: string;
  configOwnerUserId?: string;
  email: string;
  customerName?: string;
  childAge?: number | null;
  preferredTimeText?: string;
  bookedBy?: BookedBy;
  manualTitle?: string;
  manualDuration?: number;
  sendWhatsAppConfirmation?: boolean;
}

/**
 * Executes a demo/call booking:
 * 1. Checks or loads calendar configuration.
 * 2. Parses target date/time slot.
 * 3. Creates event in Google Calendar with Google Meet link (if connected).
 * 4. Updates contact's email in CRM.
 * 5. Saves record in calendar_bookings.
 * 6. Sends formatted WhatsApp confirmation to the customer (if enabled).
 */
/**
 * Finds an active confirmed booking for a contact, if any.
 */
export async function findActiveBookingForContact(
  db: SupabaseClient,
  accountId: string,
  contactId: string,
): Promise<CalendarBooking | null> {
  const { data, error } = await db
    .from('calendar_bookings')
    .select('*')
    .eq('account_id', accountId)
    .eq('contact_id', contactId)
    .eq('status', 'confirmed')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    console.warn('[booking-coordinator] findActiveBookingForContact error:', error);
    return null;
  }
  return data as CalendarBooking | null;
}

/**
 * Reschedules an existing demo/call booking in Google Calendar and updates the CRM record.
 */
export async function rescheduleDemoBooking(args: {
  db: SupabaseClient;
  accountId: string;
  contactId: string;
  bookingId: string;
  newStartTime: string;
  newEndTime: string;
  timezone?: string;
  configOwnerUserId?: string;
  conversationId?: string;
  notes?: string;
}): Promise<{
  success: boolean;
  booking?: CalendarBooking;
  googleResult?: GoogleBookingResult;
  error?: string;
}> {
  const {
    db,
    accountId,
    bookingId,
    newStartTime,
    newEndTime,
    timezone = 'Asia/Kolkata',
  } = args;

  const { data: existing, error: fetchErr } = await db
    .from('calendar_bookings')
    .select('*')
    .eq('id', bookingId)
    .eq('account_id', accountId)
    .single();

  if (fetchErr || !existing) {
    return { success: false, error: 'Booking not found' };
  }

  const calConfig = await loadCalendarConfig(db, accountId);
  let googleRes: GoogleBookingResult | null = null;

  // If there is an external Google event ID, update the event in Google Calendar
  if (
    existing.google_event_id &&
    calConfig?.is_active &&
    (calConfig.service_account_key || calConfig.oauth_credentials)
  ) {
    try {
      googleRes = await updateGoogleCalendarBooking(calConfig, {
        eventId: existing.google_event_id,
        startTime: newStartTime,
        endTime: newEndTime,
        timezone: timezone || existing.timezone || 'Asia/Kolkata',
      });
    } catch (updateErr: unknown) {
      const msg = updateErr instanceof Error ? updateErr.message : String(updateErr);
      console.error('[booking-coordinator] Failed to reschedule Google Calendar event:', msg);
      return { success: false, error: msg };
    }
  }

  const { data: updatedBooking, error: updateDbErr } = await db
    .from('calendar_bookings')
    .update({
      start_time: newStartTime,
      end_time: newEndTime,
      timezone: timezone || existing.timezone,
      status: 'confirmed',
      updated_at: new Date().toISOString(),
    })
    .eq('id', bookingId)
    .select('*')
    .single();

  if (updateDbErr) {
    return { success: false, error: updateDbErr.message };
  }

  return {
    success: true,
    booking: updatedBooking as CalendarBooking,
    googleResult: googleRes || undefined,
  };
}

export async function executeDemoBooking(
  args: ExecuteBookingArgs,
): Promise<BookingResult> {
  const {
    db,
    accountId,
    contactId,
    conversationId,
    configOwnerUserId,
    email,
    preferredTimeText,
    bookedBy = 'ai',
    manualTitle,
    manualDuration,
    sendWhatsAppConfirmation = true,
  } = args;

  // 1. Fetch contact info
  const { data: contact } = await db
    .from('contacts')
    .select('id, name, phone, email')
    .eq('id', contactId)
    .maybeSingle();

  const contactName = args.customerName || contact?.name || 'Customer';
  const contactPhone = contact?.phone || '';

  // 2. Fetch Google Calendar Config
  const calConfig = await loadCalendarConfig(db, accountId);

  const durationMinutes =
    manualDuration || calConfig?.default_meeting_duration || 45;
  const timezone = calConfig?.default_timezone || 'Asia/Kolkata';

  let titleBase = manualTitle || calConfig?.default_meeting_title || 'LeadPilot Demo Call: {{name}}';
  if (titleBase.includes('{{name}}') || titleBase.includes('{name}')) {
    titleBase = titleBase.replace(/\{\{name\}\}/g, contactName).replace(/\{name\}/g, contactName);
  } else if (!manualTitle) {
    titleBase = `${titleBase}: ${contactName}`;
  }
  const meetingTitle = titleBase;

  // 3. Parse booking slot in target timezone
  const slot = parseBookingSlot(
    preferredTimeText || 'tomorrow 11am',
    durationMinutes,
    new Date(),
    timezone,
  );

  let googleResult: GoogleBookingResult | null = null;
  let meetLink: string | null = null;
  let googleEventId: string | null = null;
  let htmlLink: string | null = null;

  // 4. Create event on Google Calendar if credentials exist
  const hasCredentials = Boolean(
    calConfig?.is_active &&
    (calConfig.service_account_key || calConfig.oauth_credentials)
  );

  if (!hasCredentials) {
    console.warn('[booking-coordinator] No active Google Calendar configured for account:', accountId);
    return {
      success: false,
      error: 'no_calendar_configured',
      readableDateTime: formatBookingDateTime(slot.startTime, timezone),
    };
  }

  try {
    googleResult = await createGoogleCalendarBooking(calConfig!, {
      title: meetingTitle,
      description: `Demo Call booked via LeadPilot WhatsApp CRM.\nContact: ${contactName}\nPhone: ${contactPhone}\nEmail: ${email}`,
      attendeeEmail: email,
      attendeeName: contactName,
      startTime: slot.startTime,
      endTime: slot.endTime,
      timezone,
    });

    googleEventId = googleResult.eventId;
    meetLink = googleResult.meetLink;
    htmlLink = googleResult.htmlLink;
  } catch (gErr: unknown) {
    const errMessage = gErr instanceof Error ? gErr.message : String(gErr);
    console.error('[booking-coordinator] Google Calendar API error:', errMessage);

    // GOLDEN RULE: Never fake a booking! If Google Calendar API fails, return controlled failure.
    return {
      success: false,
      error: errMessage,
      readableDateTime: formatBookingDateTime(slot.startTime, timezone),
    };
  }

  if (!googleEventId) {
    return {
      success: false,
      error: 'google_event_id_missing',
      readableDateTime: formatBookingDateTime(slot.startTime, timezone),
    };
  }

  // If no meet link was returned, provide default meeting note
  if (!meetLink) {
    meetLink = 'Google Calendar invite sent to email';
  }

  // 5. Update contact email if empty or changed
  if (contact && (!contact.email || contact.email !== email)) {
    await db
      .from('contacts')
      .update({ email, updated_at: new Date().toISOString() })
      .eq('id', contactId);
  }

  // 6. Format human readable date & time and confirmation message
  const readableDateTime = formatBookingDateTime(slot.startTime, timezone);
  const confirmationMessage = formatConfirmationMessage(
    calConfig?.confirmation_message_template,
    {
      name: contactName,
      email,
      dateTime: readableDateTime,
      meetLink,
      title: meetingTitle,
    },
  );

  // 7. Save booking in DB ONLY AFTER external calendar creation succeeded
  const bookingData = {
    account_id: accountId,
    contact_id: contactId,
    conversation_id: conversationId || null,
    booked_by: bookedBy,
    google_event_id: googleEventId,
    google_calendar_id: calConfig?.calendar_id || 'primary',
    title: meetingTitle,
    description: `Booked via LeadPilot WhatsApp CRM for ${contactName}`,
    attendee_email: email,
    attendee_name: contactName,
    attendee_phone: contactPhone,
    start_time: googleResult.startTime || slot.startTime,
    end_time: googleResult.endTime || slot.endTime,
    timezone,
    meet_link: meetLink,
    html_link: htmlLink,
    status: 'confirmed',
    confirmation_sent: false,
    metadata: {
      preferred_time_input: preferredTimeText || null,
      google_calendar_synced: true,
      external_event_id: googleEventId,
    },
  };

  const { data: insertedBooking, error: bookingErr } = await db
    .from('calendar_bookings')
    .insert(bookingData)
    .select()
    .single();

  if (bookingErr) {
    console.error('[booking-coordinator] failed to insert booking:', bookingErr);
  }

  const finalBooking = (insertedBooking || {
    id: `temp-${Date.now()}`,
    ...bookingData,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }) as CalendarBooking;

  // 8. Send WhatsApp confirmation message if requested
  if (sendWhatsAppConfirmation && conversationId && configOwnerUserId) {
    try {
      await engineSendText({
        accountId,
        userId: configOwnerUserId,
        conversationId,
        contactId,
        text: confirmationMessage,
        aiGenerated: bookedBy === 'ai',
      });

      if (finalBooking.id && !finalBooking.id.startsWith('temp-')) {
        await db
          .from('calendar_bookings')
          .update({
            confirmation_sent: true,
            confirmation_sent_at: new Date().toISOString(),
          })
          .eq('id', finalBooking.id);
        finalBooking.confirmation_sent = true;
      }
    } catch (sendErr) {
      console.error('[booking-coordinator] failed to send WhatsApp confirmation:', sendErr);
    }
  }

  return {
    success: true,
    booking: finalBooking,
    confirmationMessage,
    meetLink,
    googleEventId,
  };
}
