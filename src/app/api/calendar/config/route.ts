import { NextResponse } from 'next/server';
import {
  getCurrentAccount,
  requireRole,
  toErrorResponse,
} from '@/lib/auth/account';
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit';
import { encrypt, decrypt } from '@/lib/whatsapp/encryption';
import type { CalendarAuthType, ServiceAccountKey } from '@/types/calendar';

function bad(message: string) {
  return NextResponse.json({ error: message }, { status: 400 });
}

/**
 * GET /api/calendar/config
 *
 * Any member of the workspace may view the calendar config status.
 * Sensitive keys are NEVER returned to the client — only `has_key` and safe flags.
 */
export async function GET() {
  try {
    const { supabase, accountId } = await getCurrentAccount();

    const { data, error } = await supabase
      .from('google_calendar_configs')
      .select(
        'calendar_id, auth_type, service_account_key, oauth_credentials, is_active, auto_booking_enabled, default_meeting_title, default_meeting_duration, default_timezone, working_hours_start, working_hours_end, buffer_between_meetings, confirmation_message_template, updated_at',
      )
      .eq('account_id', accountId)
      .maybeSingle();

    if (error) {
      if (error.code === '42P01') {
        return NextResponse.json({ configured: false });
      }
      console.error('[calendar/config GET] error:', error);
      return NextResponse.json(
        { error: 'Failed to load Google Calendar configuration' },
        { status: 500 },
      );
    }

    if (!data) return NextResponse.json({ configured: false });

    let serviceAccountEmail: string | null = null;
    const hasKey = Boolean(data.service_account_key || data.oauth_credentials);

    if (data.service_account_key) {
      try {
        let raw = data.service_account_key;
        if (raw.includes(':')) {
          raw = decrypt(raw);
        }
        const parsed = JSON.parse(raw) as ServiceAccountKey;
        serviceAccountEmail = parsed.client_email || null;
      } catch {
        // ignore
      }
    }

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { service_account_key, oauth_credentials, ...safe } = data;

    return NextResponse.json({
      configured: true,
      has_key: hasKey,
      service_account_email: serviceAccountEmail,
      ...safe,
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}

/**
 * POST /api/calendar/config  (admin+)
 *
 * Upsert the workspace's Google Calendar configuration.
 * Stores keys AES-256-GCM encrypted.
 */
export async function POST(request: Request) {
  try {
    const { supabase, accountId, userId } = await requireRole('admin');

    const limit = checkRateLimit(`cal-config:${userId}`, RATE_LIMITS.adminAction);
    if (!limit.success) return rateLimitResponse(limit);

    const body = await request.json().catch(() => null);
    if (!body || typeof body !== 'object') return bad('Invalid request body');

    const authType = (body.auth_type as CalendarAuthType) || 'service_account';
    if (authType !== 'service_account' && authType !== 'oauth') {
      return bad('auth_type must be "service_account" or "oauth"');
    }

    const calendarId = typeof body.calendar_id === 'string' && body.calendar_id.trim()
      ? body.calendar_id.trim()
      : 'primary';

    const isActive = body.is_active === true;
    const autoBookingEnabled = body.auto_booking_enabled !== false;
    const defaultMeetingTitle =
      typeof body.default_meeting_title === 'string' && body.default_meeting_title.trim()
        ? body.default_meeting_title.trim()
        : 'LeadPilot Demo Call';

    let defaultMeetingDuration = Number(body.default_meeting_duration);
    if (!Number.isFinite(defaultMeetingDuration) || defaultMeetingDuration < 5) {
      defaultMeetingDuration = 30;
    }

    const defaultTimezone =
      typeof body.default_timezone === 'string' && body.default_timezone.trim()
        ? body.default_timezone.trim()
        : 'UTC';

    const workingHoursStart =
      typeof body.working_hours_start === 'string' && body.working_hours_start.trim()
        ? body.working_hours_start.trim()
        : '09:00';

    const workingHoursEnd =
      typeof body.working_hours_end === 'string' && body.working_hours_end.trim()
        ? body.working_hours_end.trim()
        : '18:00';

    let bufferMinutes = Number(body.buffer_between_meetings);
    if (!Number.isFinite(bufferMinutes)) bufferMinutes = 15;

    const confirmationTemplate =
      typeof body.confirmation_message_template === 'string'
        ? body.confirmation_message_template.trim()
        : null;

    // Fetch existing row to preserve existing credentials if not re-provided
    const { data: existing } = await supabase
      .from('google_calendar_configs')
      .select('service_account_key, oauth_credentials')
      .eq('account_id', accountId)
      .maybeSingle();

    let encryptedServiceAccountKey = existing?.service_account_key || null;
    let encryptedOAuthCreds = existing?.oauth_credentials || null;

    // If new Service Account key was pasted
    if (typeof body.service_account_key === 'string' && body.service_account_key.trim()) {
      const rawKey = body.service_account_key.trim();
      try {
        const parsed = JSON.parse(rawKey);
        if (!parsed.client_email || !parsed.private_key) {
          return bad('Invalid Service Account JSON: client_email and private_key are required');
        }
      } catch {
        return bad('Invalid Service Account JSON: must be valid JSON');
      }
      encryptedServiceAccountKey = encrypt(rawKey);
    }

    // If new OAuth credentials was provided
    if (typeof body.oauth_credentials === 'string' && body.oauth_credentials.trim()) {
      encryptedOAuthCreds = encrypt(body.oauth_credentials.trim());
    } else if (typeof body.oauth_credentials === 'object' && body.oauth_credentials !== null) {
      encryptedOAuthCreds = encrypt(JSON.stringify(body.oauth_credentials));
    }

    const upsertData = {
      account_id: accountId,
      created_by: userId,
      calendar_id: calendarId,
      auth_type: authType,
      service_account_key: encryptedServiceAccountKey,
      oauth_credentials: encryptedOAuthCreds,
      is_active: isActive,
      auto_booking_enabled: autoBookingEnabled,
      default_meeting_title: defaultMeetingTitle,
      default_meeting_duration: defaultMeetingDuration,
      default_timezone: defaultTimezone,
      working_hours_start: workingHoursStart,
      working_hours_end: workingHoursEnd,
      buffer_between_meetings: bufferMinutes,
      confirmation_message_template: confirmationTemplate,
      updated_at: new Date().toISOString(),
    };

    const { error: upsertErr } = await supabase
      .from('google_calendar_configs')
      .upsert(upsertData, { onConflict: 'account_id' });

    if (upsertErr) {
      console.error('[calendar/config POST] upsert error:', upsertErr);
      return NextResponse.json(
        { error: 'Failed to save Google Calendar configuration' },
        { status: 500 },
      );
    }

    return NextResponse.json({
      success: true,
      configured: true,
      has_key: Boolean(encryptedServiceAccountKey || encryptedOAuthCreds),
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}

/**
 * DELETE /api/calendar/config  (admin+)
 *
 * Disconnect and remove Google Calendar configuration.
 */
export async function DELETE() {
  try {
    const { supabase, accountId, userId } = await requireRole('admin');

    const limit = checkRateLimit(`cal-config:${userId}`, RATE_LIMITS.adminAction);
    if (!limit.success) return rateLimitResponse(limit);

    const { error } = await supabase
      .from('google_calendar_configs')
      .delete()
      .eq('account_id', accountId);

    if (error) {
      console.error('[calendar/config DELETE] error:', error);
      return NextResponse.json(
        { error: 'Failed to delete configuration' },
        { status: 500 },
      );
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    return toErrorResponse(err);
  }
}
