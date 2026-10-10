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
import type { MeetingLinkMode, TenantProductConfig } from '@/lib/ai/actions/types';

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
    email?: string | null;
    dateTime: string;
    meetLink?: string | null;
    title: string;
    duration?: number;
    meetingMode?: MeetingLinkMode;
  },
): string {
  const hasRealMeetLink = Boolean(params.meetLink && params.meetLink.startsWith('http'));
  const hasEmail = Boolean(params.email && params.email.includes('@'));
  const mode = params.meetingMode || (hasRealMeetLink ? 'GOOGLE_MEET' : 'NONE');

  let defaultTemplate =
    `Perfect 😊 Your {{title}} is booked!\n\n` +
    `📅 {{date_time}}\n` +
    `⏱️ {{duration}} minutes\n`;

  if (mode === 'GOOGLE_MEET' && hasRealMeetLink) {
    defaultTemplate += `💻 Google Meet: {{meet_link}}\n`;
  } else if (mode === 'ZOOM' && hasRealMeetLink) {
    defaultTemplate += `📹 Zoom: {{meet_link}}\n`;
  } else if (mode === 'STATIC_MEETING_LINK' && hasRealMeetLink) {
    defaultTemplate += `🔗 Meeting Link: {{meet_link}}\n`;
  } else if (mode === 'BOOKING_PAGE' && hasRealMeetLink) {
    defaultTemplate += `📅 Booking Link: {{meet_link}}\n`;
  } else if (mode === 'NONE' || mode === 'MANUAL_FOLLOW_UP' || !hasRealMeetLink) {
    defaultTemplate += `📞 We will call you directly for the session.\n`;
  }

  if (hasEmail) {
    defaultTemplate += `📧 Calendar invite sent to: {{email}}\n`;
  }

  defaultTemplate += `\nSee you there! 🎉`;

  let rendered = template && template.trim() ? template : defaultTemplate;

  // If template contains meet_link but no real link exists, strip out that line
  if (!hasRealMeetLink) {
    rendered = rendered
      .replace(/^[^\n]*\{\{meet_link\}\}[^\n]*\n?/gm, '')
      .replace(/^[^\n]*Google Meet[^\n]*\n?/gim, '')
      .replace(/^[^\n]*Zoom[^\n]*\n?/gim, '');
  }

  // If no email or template has invite sent to email, clean up
  if (!hasEmail) {
    rendered = rendered
      .replace(/^[^\n]*\{\{email\}\}[^\n]*\n?/gm, '')
      .replace(/^[^\n]*Calendar invite sent to[^\n]*\n?/gim, '');
  }

  rendered = rendered
    .replace(/\{\{name\}\}/g, params.name || 'there')
    .replace(/\{name\}/g, params.name || 'there')
    .replace(/\{\{email\}\}/g, params.email || '')
    .replace(/\{email\}/g, params.email || '')
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
  email?: string | null;
  customerName?: string;
  childAge?: number | null;
  preferredTimeText?: string;
  bookedBy?: BookedBy;
  manualTitle?: string;
  manualDuration?: number;
  sendWhatsAppConfirmation?: boolean;
  productConfig?: TenantProductConfig;
  productServiceId?: string;
  meetingMode?: MeetingLinkMode;
  staticMeetingLink?: string | null;
  timezone?: string;
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
    productConfig,
    productServiceId,
    meetingMode: explicitMeetingMode,
    staticMeetingLink: explicitStaticLink,
    timezone: explicitTimezone,
  } = args;

  // 1. Fetch contact info
  const { data: contact } = await db
    .from('contacts')
    .select('id, name, phone, email')
    .eq('id', contactId)
    .maybeSingle();

  const contactName = args.customerName || contact?.name || 'Customer';
  const contactPhone = contact?.phone || '';
  const effectiveEmail = email || contact?.email || null;

  // 2. Fetch Google Calendar Config
  const calConfig = await loadCalendarConfig(db, accountId);

  if (bookedBy === 'ai' && calConfig && calConfig.auto_booking_enabled === false) {
    return {
      success: false,
      error: 'AI booking permission is disabled in calendar settings',
    };
  }

  // 3. Resolve Meeting Mode & Settings
  const meetingMode: MeetingLinkMode =
    explicitMeetingMode || productConfig?.meetingMode || 'GOOGLE_MEET';

  // If self-scheduling BOOKING_PAGE mode: return booking page URL without claiming a verified booking exists!
  if (meetingMode === 'BOOKING_PAGE') {
    const pageUrl = productConfig?.meetingLink || explicitStaticLink || '';
    const bookingPageMsg = pageUrl
      ? `You can choose a convenient slot and complete your booking directly on our calendar page here:\n🔗 ${pageUrl}`
      : `Please visit our booking page to select your preferred appointment slot.`;
    return {
      success: true,
      meetLink: pageUrl || null,
      confirmationMessage: bookingPageMsg,
    };
  }

  const durationMinutes =
    manualDuration || productConfig?.durationMinutes || calConfig?.default_meeting_duration || 45;
  const timezone =
    explicitTimezone || productConfig?.timezone || calConfig?.default_timezone || 'Asia/Kolkata';

  let titleBase =
    manualTitle ||
    productConfig?.eventTitleTemplate ||
    calConfig?.default_meeting_title ||
    'LeadPilot Demo Call: {{name}}';

  if (titleBase.includes('{{name}}') || titleBase.includes('{name}')) {
    titleBase = titleBase.replace(/\{\{name\}\}/g, contactName).replace(/\{name\}/g, contactName);
  } else if (!manualTitle) {
    titleBase = `${titleBase}: ${contactName}`;
  }
  const meetingTitle = titleBase;

  // 4. Parse booking slot in target timezone
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

  // 5. Provider Execution according to meetingMode
  const hasCalendarCredentials = Boolean(
    calConfig?.is_active &&
    (calConfig.service_account_key || calConfig.oauth_credentials)
  );

  if (meetingMode === 'GOOGLE_MEET') {
    if (!hasCalendarCredentials) {
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
        description: `Demo Call booked via LeadPilot WhatsApp CRM.\nContact: ${contactName}\nPhone: ${contactPhone}${effectiveEmail ? `\nEmail: ${effectiveEmail}` : ''}`,
        attendeeEmail: effectiveEmail || '',
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

    if (!meetLink) {
      meetLink = effectiveEmail ? 'Google Calendar invite sent to email' : null;
    }
  } else if (meetingMode === 'ZOOM') {
    meetLink = explicitStaticLink || productConfig?.meetingLink || null;
    if (hasCalendarCredentials) {
      try {
        googleResult = await createGoogleCalendarBooking(calConfig!, {
          title: meetingTitle,
          description: `Zoom Call booked via LeadPilot WhatsApp CRM.\nContact: ${contactName}\nPhone: ${contactPhone}${meetLink ? `\nZoom: ${meetLink}` : ''}`,
          attendeeEmail: effectiveEmail || '',
          attendeeName: contactName,
          startTime: slot.startTime,
          endTime: slot.endTime,
          timezone,
        });
        googleEventId = googleResult.eventId;
        htmlLink = googleResult.htmlLink;
      } catch (err) {
        console.warn('[booking-coordinator] Zoom mode calendar sync error (non-fatal):', err);
      }
    }
  } else if (meetingMode === 'STATIC_MEETING_LINK') {
    meetLink = explicitStaticLink || productConfig?.meetingLink || null;
    if (hasCalendarCredentials) {
      try {
        googleResult = await createGoogleCalendarBooking(calConfig!, {
          title: meetingTitle,
          description: `Call booked via LeadPilot WhatsApp CRM.\nContact: ${contactName}\nPhone: ${contactPhone}${meetLink ? `\nMeeting Link: ${meetLink}` : ''}`,
          attendeeEmail: effectiveEmail || '',
          attendeeName: contactName,
          startTime: slot.startTime,
          endTime: slot.endTime,
          timezone,
        });
        googleEventId = googleResult.eventId;
        htmlLink = googleResult.htmlLink;
      } catch (err) {
        console.warn('[booking-coordinator] Static link calendar sync error (non-fatal):', err);
      }
    }
  } else {
    // NONE or MANUAL_FOLLOW_UP (in-person or phone call)
    meetLink = null;
    if (hasCalendarCredentials) {
      try {
        googleResult = await createGoogleCalendarBooking(calConfig!, {
          title: meetingTitle,
          description: `Appointment booked via LeadPilot WhatsApp CRM.\nContact: ${contactName}\nPhone: ${contactPhone}\nMode: Direct phone / in-person`,
          attendeeEmail: effectiveEmail || '',
          attendeeName: contactName,
          startTime: slot.startTime,
          endTime: slot.endTime,
          timezone,
        });
        googleEventId = googleResult.eventId;
        htmlLink = googleResult.htmlLink;
      } catch (err) {
        console.warn('[booking-coordinator] Phone/In-person calendar sync error (non-fatal):', err);
      }
    }
  }

  // 6. Update contact email if provided and changed
  if (effectiveEmail && contact && (!contact.email || contact.email !== effectiveEmail)) {
    await db
      .from('contacts')
      .update({ email: effectiveEmail, updated_at: new Date().toISOString() })
      .eq('id', contactId);
  }

  // 7. Format human readable date & time and confirmation message
  const readableDateTime = formatBookingDateTime(slot.startTime, timezone);
  const confirmationTemplate =
    productConfig?.confirmationTemplate || calConfig?.confirmation_message_template;

  const actualEffectiveMeetingMode: MeetingLinkMode =
    meetingMode === 'GOOGLE_MEET' && !meetLink ? 'NONE' : meetingMode;

  const confirmationMessage = formatConfirmationMessage(
    confirmationTemplate,
    {
      name: contactName,
      email: effectiveEmail,
      dateTime: readableDateTime,
      meetLink,
      title: meetingTitle,
      duration: durationMinutes,
      meetingMode: actualEffectiveMeetingMode,
    },
  );

  // 8. Save booking in DB
  const bookingData = {
    account_id: accountId,
    contact_id: contactId,
    conversation_id: conversationId || null,
    booked_by: bookedBy,
    google_event_id: googleEventId || (meetingMode !== 'GOOGLE_MEET' ? `internal-${Date.now()}` : null),
    google_calendar_id: calConfig?.calendar_id || 'primary',
    title: meetingTitle,
    description: `Booked via LeadPilot WhatsApp CRM for ${contactName}`,
    attendee_email: effectiveEmail || '',
    attendee_name: contactName,
    attendee_phone: contactPhone,
    start_time: googleResult?.startTime || slot.startTime,
    end_time: googleResult?.endTime || slot.endTime,
    timezone,
    meet_link: meetLink,
    html_link: htmlLink,
    status: 'confirmed' as const,
    confirmation_sent: false,
    product_service_id: productConfig?.productServiceId || productServiceId || null,
    meeting_mode: actualEffectiveMeetingMode,
    metadata: {
      preferred_time_input: preferredTimeText || null,
      google_calendar_synced: Boolean(googleEventId),
      external_event_id: googleEventId,
      product_service_id: productConfig?.productServiceId || productServiceId || null,
      meeting_mode: actualEffectiveMeetingMode,
      meet_link_generated: Boolean(meetLink),
    },
  };

  let insertedBooking: CalendarBooking | null = null;
  const { data: inserted, error: bookingErr } = await db
    .from('calendar_bookings')
    .insert(bookingData)
    .select()
    .single();

  if (bookingErr) {
    console.error('[booking-coordinator] failed to insert booking:', bookingErr);
    // If table schema cache does not yet have meeting_mode or product_service_id (pre-migration 048)
    if (
      bookingErr.code === 'PGRST204' ||
      bookingErr.message?.includes('meeting_mode') ||
      bookingErr.message?.includes('product_service_id')
    ) {
      console.log('[booking-coordinator] Retrying insert with baseline schema compatibility...');
      const fallbackBookingData = { ...bookingData } as Record<string, unknown>;
      delete fallbackBookingData.meeting_mode;
      delete fallbackBookingData.product_service_id;
      const { data: fallbackInserted, error: fallbackErr } = await db
        .from('calendar_bookings')
        .insert(fallbackBookingData)
        .select()
        .single();
      if (!fallbackErr && fallbackInserted) {
        insertedBooking = fallbackInserted as CalendarBooking;
      }
    }
  } else if (inserted) {
    insertedBooking = inserted as CalendarBooking;
  }

  if (!insertedBooking) {
    console.error('[booking-coordinator] Failed to persist booking record in database');
    return {
      success: false,
      error: 'database_insert_failed',
      readableDateTime,
    };
  }

  const finalBooking = insertedBooking;

  // 9. Send WhatsApp confirmation message if requested
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
    readableDateTime,
  };
}
