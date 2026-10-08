import { NextResponse } from 'next/server';
import { requireRole, toErrorResponse } from '@/lib/auth/account';
import { testGoogleCalendarConnection } from '@/lib/calendar/google-calendar';
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit';

export async function POST(request: Request) {
  try {
    const { supabase, accountId, userId } = await requireRole('admin');

    const limit = checkRateLimit(`cal-test:${userId}`, RATE_LIMITS.adminAction);
    if (!limit.success) return rateLimitResponse(limit);

    const body = await request.json().catch(() => ({}));

    // If test payload is provided in request body (e.g. testing credentials before saving)
    if (body.service_account_key || body.oauth_credentials) {
      const result = await testGoogleCalendarConnection({
        auth_type: body.auth_type || 'service_account',
        service_account_key: body.service_account_key,
        oauth_credentials: body.oauth_credentials,
        calendar_id: body.calendar_id || 'primary',
      });
      return NextResponse.json(result);
    }

    // Otherwise, load saved configuration from database
    const { data: config, error } = await supabase
      .from('google_calendar_configs')
      .select('auth_type, service_account_key, oauth_credentials, calendar_id')
      .eq('account_id', accountId)
      .maybeSingle();

    if (error || !config) {
      return NextResponse.json({
        success: false,
        error: 'No Google Calendar configuration found for this account',
      });
    }

    if (!config.service_account_key && !config.oauth_credentials) {
      return NextResponse.json({
        success: false,
        error: 'No credentials stored in configuration. Please provide a Service Account key.',
      });
    }

    const result = await testGoogleCalendarConnection(config);
    return NextResponse.json(result);
  } catch (err) {
    return toErrorResponse(err);
  }
}
