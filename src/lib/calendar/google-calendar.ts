import { decrypt } from '@/lib/whatsapp/encryption';
import type {
  GoogleCalendarConfig,
  ServiceAccountKey,
  OAuthCredentials,
} from '@/types/calendar';

export interface CreateBookingArgs {
  title: string;
  description?: string;
  attendeeEmail: string;
  attendeeName?: string;
  startTime: string; // ISO string
  endTime: string;   // ISO string
  timezone?: string;
}

export interface GoogleBookingResult {
  eventId: string;
  meetLink: string | null;
  htmlLink: string | null;
  startTime: string;
  endTime: string;
  title: string;
}

/**
 * Parses raw or encrypted credentials into an object.
 */
function parseKeyPayload<T>(rawKey: string): T {
  let str = rawKey.trim();
  if (!str.startsWith('{')) {
    try {
      str = decrypt(str);
    } catch (err) {
      console.error('[google-calendar] Decryption error in parseKeyPayload:', err);
      throw new Error(`Failed to decrypt Google credentials: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  return JSON.parse(str) as T;
}

/**
 * Creates an authenticated Google Calendar client from the stored configuration.
 * Uses dynamic import so googleapis does not slow down cold boots or unauthenticated paths.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function getGoogleCalendarClient(config: Pick<GoogleCalendarConfig, 'auth_type' | 'service_account_key' | 'oauth_credentials'>): Promise<any> {
  const { google } = await import('googleapis');

  if (config.auth_type === 'service_account') {
    if (!config.service_account_key) {
      throw new Error('Google Service Account credentials are not configured');
    }

    const key = parseKeyPayload<ServiceAccountKey>(config.service_account_key);
    if (!key.client_email || !key.private_key) {
      throw new Error('Invalid Service Account JSON: missing client_email or private_key');
    }

    const jwtClient = new google.auth.JWT({
      email: key.client_email,
      key: key.private_key.replace(/\\n/g, '\n'),
      scopes: [
        'https://www.googleapis.com/auth/calendar',
        'https://www.googleapis.com/auth/calendar.events',
      ],
    });

    return google.calendar({ version: 'v3', auth: jwtClient });
  }

  if (config.auth_type === 'oauth') {
    if (!config.oauth_credentials) {
      throw new Error('Google OAuth credentials are not configured');
    }

    const creds = parseKeyPayload<OAuthCredentials>(config.oauth_credentials);
    if (!creds.refresh_token) {
      throw new Error('Invalid OAuth credentials: missing refresh_token');
    }

    const oauth2Client = new google.auth.OAuth2(
      creds.client_id || process.env.GOOGLE_CLIENT_ID,
      creds.client_secret || process.env.GOOGLE_CLIENT_SECRET,
    );

    oauth2Client.setCredentials({
      refresh_token: creds.refresh_token,
      access_token: creds.access_token,
    });

    return google.calendar({ version: 'v3', auth: oauth2Client });
  }

  throw new Error(`Unsupported calendar auth type: ${config.auth_type}`);
}

/**
 * Tests the connection to Google Calendar by querying the calendar metadata.
 */
export async function testGoogleCalendarConnection(
  config: Pick<GoogleCalendarConfig, 'auth_type' | 'service_account_key' | 'oauth_credentials' | 'calendar_id'>,
): Promise<{
  success: boolean;
  calendarId?: string;
  summary?: string;
  timeZone?: string;
  serviceAccountEmail?: string;
  error?: string;
}> {
  try {
    const calendar = await getGoogleCalendarClient(config);
    const targetCalendarId = config.calendar_id || 'primary';

    const res = await calendar.calendars.get({
      calendarId: targetCalendarId,
    });

    let serviceAccountEmail: string | undefined;
    if (config.auth_type === 'service_account' && config.service_account_key) {
      try {
        const key = parseKeyPayload<ServiceAccountKey>(config.service_account_key);
        serviceAccountEmail = key.client_email;
      } catch {
        // ignore
      }
    }

    return {
      success: true,
      calendarId: res.data.id || targetCalendarId,
      summary: res.data.summary || 'Connected Google Calendar',
      timeZone: res.data.timeZone || 'UTC',
      serviceAccountEmail,
    };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[google-calendar] testConnection error:', message);
    return {
      success: false,
      error: message,
    };
  }
}

/**
 * Creates an event on the user's Google Calendar with an automatic Google Meet video call link
 * and an email invitation dispatched to the attendee.
 */
export async function createGoogleCalendarBooking(
  config: Pick<GoogleCalendarConfig, 'auth_type' | 'service_account_key' | 'oauth_credentials' | 'calendar_id' | 'default_timezone'>,
  args: CreateBookingArgs,
): Promise<GoogleBookingResult> {
  const calendar = await getGoogleCalendarClient(config);
  const targetCalendarId = config.calendar_id || 'primary';
  const tz = args.timezone || config.default_timezone || 'Asia/Kolkata';

  const requestId = `leadpilot-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

  const eventPayload = {
    summary: args.title,
    description: args.description,
    start: {
      dateTime: args.startTime,
      timeZone: tz,
    },
    end: {
      dateTime: args.endTime,
      timeZone: tz,
    },
    attendees: args.attendeeEmail
      ? [
          {
            email: args.attendeeEmail,
            displayName: args.attendeeName || undefined,
            responseStatus: 'accepted',
          },
        ]
      : [],
    conferenceData: {
      createRequest: {
        requestId,
        conferenceSolutionKey: {
          type: 'hangoutsMeet',
        },
      },
    },
    reminders: {
      useDefault: false,
      overrides: [
        { method: 'email', minutes: 24 * 60 },
        { method: 'popup', minutes: 15 },
      ],
    },
  };

  let event: {
    id?: string | null;
    hangoutLink?: string | null;
    htmlLink?: string | null;
    start?: { dateTime?: string | null };
    end?: { dateTime?: string | null };
    summary?: string | null;
    conferenceData?: { entryPoints?: Array<{ entryPointType?: string; uri?: string }> };
  } | undefined;

  try {
    const res = await calendar.events.insert({
      calendarId: targetCalendarId,
      requestBody: eventPayload,
      conferenceDataVersion: 1, // Required for generating Google Meet link
      sendUpdates: 'all',        // Sends Google Calendar invitation to attendees
    });
    event = res.data;
  } catch (insertErr: unknown) {
    const errMessage = insertErr instanceof Error ? insertErr.message : String(insertErr);
    console.warn('[google-calendar] events.insert initial attempt failed:', errMessage);

    const isConferenceErr =
      errMessage.includes('conference') ||
      errMessage.includes('Invalid conference type') ||
      errMessage.includes('400');

    const isAttendeeOrDomainErr =
      errMessage.includes('Domain-Wide Delegation') ||
      errMessage.includes('cannot invite attendees') ||
      errMessage.includes('attendees') ||
      errMessage.includes('403');

    try {
      const sanitizedPayload: Record<string, unknown> = { ...eventPayload };
      let sendUpdatesOption = 'all';

      if (isConferenceErr || isAttendeeOrDomainErr) {
        delete sanitizedPayload.conferenceData;
      }
      if (isAttendeeOrDomainErr) {
        delete sanitizedPayload.attendees;
        sendUpdatesOption = 'none';
        if (args.attendeeEmail) {
          sanitizedPayload.description = `${(sanitizedPayload.description as string) || ''}\n\nAttendee: ${args.attendeeName || 'Customer'} (${args.attendeeEmail})`;
        }
      }

      console.log('[google-calendar] Retrying event creation with sanitized payload...');
      const fallbackRes = await calendar.events.insert({
        calendarId: targetCalendarId,
        requestBody: sanitizedPayload,
        conferenceDataVersion: sanitizedPayload.conferenceData ? 1 : undefined,
        sendUpdates: sendUpdatesOption as 'all' | 'none',
      });
      event = fallbackRes.data;
    } catch (secondErr: unknown) {
      const secondMsg = secondErr instanceof Error ? secondErr.message : String(secondErr);
      console.warn('[google-calendar] Second insert attempt failed:', secondMsg);

      console.log('[google-calendar] Retrying event creation with minimal safe payload...');
      const minimalPayload = {
        summary: eventPayload.summary,
        description: `${eventPayload.description || ''}${args.attendeeEmail ? `\n\nAttendee: ${args.attendeeName || 'Customer'} (${args.attendeeEmail})` : ''}`,
        start: eventPayload.start,
        end: eventPayload.end,
        reminders: eventPayload.reminders,
      };

      const finalRes = await calendar.events.insert({
        calendarId: targetCalendarId,
        requestBody: minimalPayload,
        sendUpdates: 'none',
      });
      event = finalRes.data;
    }
  }

  if (!event || !event.id) {
    throw new Error('Google Calendar did not return an event ID');
  }

  // Extract Google Meet link
  let meetLink = event.hangoutLink || null;
  if (!meetLink && event.conferenceData?.entryPoints) {
    const videoEntry = event.conferenceData.entryPoints.find(
      (ep: { entryPointType?: string }) => ep.entryPointType === 'video',
    );
    if (videoEntry?.uri) {
      meetLink = videoEntry.uri;
    }
  }

  return {
    eventId: event.id,
    meetLink,
    htmlLink: event.htmlLink || null,
    startTime: event.start?.dateTime || args.startTime,
    endTime: event.end?.dateTime || args.endTime,
    title: event.summary || args.title,
  };
}

/**
 * Reschedules / updates an existing event in Google Calendar.
 */
export async function updateGoogleCalendarBooking(
  config: Pick<GoogleCalendarConfig, 'auth_type' | 'service_account_key' | 'oauth_credentials' | 'calendar_id' | 'default_timezone'>,
  args: {
    eventId: string;
    startTime: string; // ISO
    endTime: string;   // ISO
    timezone?: string;
    title?: string;
    description?: string;
  },
): Promise<GoogleBookingResult> {
  const calendar = await getGoogleCalendarClient(config);
  const targetCalendarId = config.calendar_id || 'primary';
  const tz = args.timezone || config.default_timezone || 'Asia/Kolkata';

  const patchBody: Record<string, unknown> = {
    start: { dateTime: args.startTime, timeZone: tz },
    end: { dateTime: args.endTime, timeZone: tz },
  };
  if (args.title) patchBody.summary = args.title;
  if (args.description) patchBody.description = args.description;

  const res = await calendar.events.patch({
    calendarId: targetCalendarId,
    eventId: args.eventId,
    requestBody: patchBody,
    sendUpdates: 'all',
  });

  const event = res.data;
  if (!event.id) {
    throw new Error('Google Calendar did not return an updated event ID');
  }

  return {
    eventId: event.id,
    meetLink: event.hangoutLink || null,
    htmlLink: event.htmlLink || null,
    startTime: event.start?.dateTime || args.startTime,
    endTime: event.end?.dateTime || args.endTime,
    title: event.summary || args.title || '',
  };
}

/**
 * Cancels / removes an event from Google Calendar.
 */
export async function cancelGoogleCalendarBooking(
  config: Pick<GoogleCalendarConfig, 'auth_type' | 'service_account_key' | 'oauth_credentials' | 'calendar_id'>,
  eventId: string,
): Promise<void> {
  const calendar = await getGoogleCalendarClient(config);
  const targetCalendarId = config.calendar_id || 'primary';

  await calendar.events.delete({
    calendarId: targetCalendarId,
    eventId,
    sendUpdates: 'all',
  });
}

/**
 * Checks whether a requested time interval is available in Google Calendar.
 */
export async function checkGoogleCalendarAvailability(
  config: Pick<GoogleCalendarConfig, 'auth_type' | 'service_account_key' | 'oauth_credentials' | 'calendar_id'>,
  args: {
    startTime: string; // ISO
    endTime: string;   // ISO
  },
): Promise<{ available: boolean; conflictReason?: string }> {
  try {
    const calendar = await getGoogleCalendarClient(config);
    const targetCalendarId = config.calendar_id || 'primary';

    const res = await calendar.events.list({
      calendarId: targetCalendarId,
      timeMin: args.startTime,
      timeMax: args.endTime,
      singleEvents: true,
    });

    const activeEvents = (res.data.items || []).filter(
      (ev: { status?: string }) => ev.status !== 'cancelled',
    );

    if (activeEvents.length > 0) {
      return {
        available: false,
        conflictReason: `Conflicting event: ${activeEvents[0].summary || 'Busy'}`,
      };
    }

    return { available: true };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn('[google-calendar] checkAvailability error:', message);
    // On unexpected calendar error, return available: false so we don't double book
    return { available: false, conflictReason: message };
  }
}

export interface AvailableSlotResult {
  startTime: string;
  endTime: string;
  humanText: string;
}

function getTimezoneOffsetString(date: Date, timeZone: string): string {
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone,
      timeZoneName: 'longOffset',
    }).formatToParts(date);
    const tzPart = parts.find((p) => p.type === 'timeZoneName')?.value;
    if (!tzPart || tzPart === 'GMT') return '+00:00';
    const match = tzPart.match(/GMT([+-])(\d{1,2})(?::?(\d{2}))?/);
    if (!match) return '+00:00';
    const sign = match[1];
    const hours = match[2].padStart(2, '0');
    const minutes = (match[3] || '00').padStart(2, '0');
    return `${sign}${hours}:${minutes}`;
  } catch {
    return '+05:30';
  }
}

/**
 * Retrieves actual free slots on a given date during working hours.
 */
export async function getGoogleCalendarAvailableSlots(
  config: Pick<
    GoogleCalendarConfig,
    | 'auth_type'
    | 'service_account_key'
    | 'oauth_credentials'
    | 'calendar_id'
    | 'default_timezone'
    | 'working_hours_start'
    | 'working_hours_end'
    | 'buffer_between_meetings'
  >,
  args: {
    targetDate: Date | string; // Date or ISO string
    durationMinutes: number;
    timezone?: string;
    count?: number;
  },
): Promise<AvailableSlotResult[]> {
  const { durationMinutes, count = 3 } = args;
  const tz = args.timezone || config.default_timezone || 'Asia/Kolkata';
  const workStartStr = config.working_hours_start || '09:00';
  const workEndStr = config.working_hours_end || '18:00';
  const buffer = config.buffer_between_meetings ?? 15;

  const baseDate = typeof args.targetDate === 'string' ? new Date(args.targetDate) : args.targetDate;
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(baseDate);
  const get = (type: string) => parts.find((p) => p.type === type)?.value || '';
  const y = get('year');
  const m = get('month');
  const d = get('day');
  const offset = getTimezoneOffsetString(baseDate, tz);

  const dayStart = new Date(`${y}-${m}-${d}T${workStartStr.padStart(5, '0')}:00${offset}`);
  const dayEnd = new Date(`${y}-${m}-${d}T${workEndStr.padStart(5, '0')}:00${offset}`);

  let busyIntervals: Array<{ start: number; end: number }> = [];

  try {
    const calendar = await getGoogleCalendarClient(config);
    const targetCalendarId = config.calendar_id || 'primary';

    const res = await calendar.events.list({
      calendarId: targetCalendarId,
      timeMin: dayStart.toISOString(),
      timeMax: dayEnd.toISOString(),
      singleEvents: true,
      orderBy: 'startTime',
    });

    busyIntervals = (res.data.items || [])
      .filter((ev: { status?: string }) => ev.status !== 'cancelled')
      .map((ev: { start?: { dateTime?: string }; end?: { dateTime?: string } }) => {
        const start = ev.start?.dateTime ? new Date(ev.start.dateTime).getTime() : 0;
        const end = ev.end?.dateTime ? new Date(ev.end.dateTime).getTime() : 0;
        return { start, end };
      })
      .filter((iv: { start: number; end: number }) => iv.start > 0 && iv.end > 0);
  } catch (err) {
    console.warn('[google-calendar] getAvailableSlots list error, falling back to schedule intervals:', err);
  }

  const results: AvailableSlotResult[] = [];
  let currentCandidate = new Date(dayStart);
  const slotMs = durationMinutes * 60 * 1000;
  const bufferMs = buffer * 60 * 1000;

  while (currentCandidate.getTime() + slotMs <= dayEnd.getTime() && results.length < count) {
    const candStart = currentCandidate.getTime();
    const candEnd = candStart + slotMs;

    // Check if overlaps with any busy interval
    const isConflict = busyIntervals.some(
      (b) => Math.max(candStart, b.start) < Math.min(candEnd, b.end),
    );

    if (!isConflict) {
      const dStart = new Date(candStart);
      const dEnd = new Date(candEnd);

      const humanFormatted = new Intl.DateTimeFormat('en-US', {
        timeZone: tz,
        weekday: 'short',
        month: 'short',
        day: 'numeric',
        hour: 'numeric',
        minute: dStart.getMinutes() === 0 ? undefined : '2-digit',
        hour12: true,
      }).format(dStart);

      const tzSuffix = tz === 'Asia/Kolkata' ? 'IST' : tz;

      results.push({
        startTime: dStart.toISOString(),
        endTime: dEnd.toISOString(),
        humanText: `${humanFormatted} ${tzSuffix}`,
      });

      // Advance by duration + buffer
      currentCandidate = new Date(candEnd + bufferMs);
    } else {
      // Step by 30 minutes
      currentCandidate = new Date(candStart + 30 * 60 * 1000);
    }
  }

  return results;
}

