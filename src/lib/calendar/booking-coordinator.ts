import type { SupabaseClient } from '@supabase/supabase-js';
import type {
  GoogleCalendarConfig,
  CalendarBooking,
  BookingResult,
  BookedBy,
} from '@/types/calendar';
import {
  createGoogleCalendarBooking,
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
    meetLink: string;
    title: string;
  },
): string {
  const defaultTemplate =
    '🎉 Great news! Your demo call has been scheduled.\n\n' +
    '📅 Date & Time: {{date_time}}\n' +
    '📧 Calendar invite sent to: {{email}}\n' +
    '📹 Google Meet: {{meet_link}}\n\n' +
    'We look forward to speaking with you! Reply here anytime if you need to reschedule.';

  let rendered = template && template.trim() ? template : defaultTemplate;

  rendered = rendered
    .replace(/\{\{name\}\}/g, params.name || 'there')
    .replace(/\{\{email\}\}/g, params.email)
    .replace(/\{\{date_time\}\}/g, params.dateTime)
    .replace(/\{\{meet_link\}\}/g, params.meetLink || 'Google Meet link in calendar invite')
    .replace(/\{\{title\}\}/g, params.title);

  return rendered;
}

export interface ExecuteBookingArgs {
  db: SupabaseClient;
  accountId: string;
  contactId: string;
  conversationId?: string;
  configOwnerUserId?: string;
  email: string;
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

  const contactName = contact?.name || 'Customer';
  const contactPhone = contact?.phone || '';

  // 2. Fetch Google Calendar Config
  const calConfig = await loadCalendarConfig(db, accountId);

  const durationMinutes =
    manualDuration || calConfig?.default_meeting_duration || 30;
  const timezone = calConfig?.default_timezone || 'UTC';
  const meetingTitle =
    manualTitle ||
    (calConfig?.default_meeting_title
      ? `${calConfig.default_meeting_title}: ${contactName}`
      : `LeadPilot Demo Call: ${contactName}`);

  // 3. Parse booking slot
  const slot = parseBookingSlot(
    preferredTimeText || 'tomorrow 11am',
    durationMinutes,
  );

  let googleResult: GoogleBookingResult | null = null;
  let meetLink: string | null = null;
  let googleEventId: string | null = null;
  let htmlLink: string | null = null;

  // 4. Create event on Google Calendar if credentials exist
  if (
    calConfig?.is_active &&
    (calConfig.service_account_key || calConfig.oauth_credentials)
  ) {
    try {
      googleResult = await createGoogleCalendarBooking(calConfig, {
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
    } catch (gErr) {
      console.error('[booking-coordinator] Google Calendar API error:', gErr);
      // Fallback: continue so lead is not dropped
    }
  }

  // If no meet link was generated (e.g. calendar offline or fallback), provide video call note
  if (!meetLink) {
    meetLink = 'Calendar invite & video link will be sent to your email';
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

  // 7. Save booking in DB
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
    start_time: slot.startTime,
    end_time: slot.endTime,
    timezone,
    meet_link: meetLink,
    html_link: htmlLink,
    status: 'confirmed',
    confirmation_sent: false,
    metadata: {
      preferred_time_input: preferredTimeText || null,
      google_calendar_synced: Boolean(googleEventId),
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
