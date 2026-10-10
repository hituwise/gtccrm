import { NextResponse } from 'next/server';
import { decrypt, encrypt } from '@/lib/whatsapp/encryption';
import { supabaseAdmin } from '@/lib/automations/admin-client';
import type { OAuthCredentials } from '@/types/calendar';

export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  const error = url.searchParams.get('error');

  const host = request.headers.get('host') || 'localhost:3000';
  const proto = request.headers.get('x-forwarded-proto') || (host.startsWith('localhost') ? 'http' : 'https');
  const baseUrl = process.env.NEXT_PUBLIC_SITE_URL || `${proto}://${host}`;
  const settingsUrl = `${baseUrl}/settings?tab=calendar`;

  if (error) {
    console.warn('[calendar/callback] User denied or Google OAuth error:', error);
    return NextResponse.redirect(`${settingsUrl}&error=${encodeURIComponent(error)}`);
  }

  if (!code || !state) {
    return NextResponse.redirect(`${settingsUrl}&error=missing_parameters`);
  }

  let stateData: {
    accountId: string;
    userId: string;
    clientId?: string;
    clientSecret?: string;
    timestamp: number;
    nonce: string;
  };

  try {
    const decryptedState = decrypt(state);
    stateData = JSON.parse(decryptedState);
  } catch (err) {
    console.error('[calendar/callback] Invalid or tempered state token:', err);
    return NextResponse.redirect(`${settingsUrl}&error=invalid_state`);
  }

  // Verify expiration: state tokens expire after 15 minutes
  if (Date.now() - stateData.timestamp > 15 * 60 * 1000) {
    return NextResponse.redirect(`${settingsUrl}&error=expired_state`);
  }

  const { accountId, userId, clientId, clientSecret } = stateData;
  const redirectUri = `${baseUrl}/api/calendar/callback`;

  try {
    const { google } = await import('googleapis');
    const effectiveClientId = clientId || process.env.GOOGLE_CLIENT_ID;
    const effectiveClientSecret = clientSecret || process.env.GOOGLE_CLIENT_SECRET;

    const oauth2Client = new google.auth.OAuth2(
      effectiveClientId,
      effectiveClientSecret,
      redirectUri,
    );

    // Exchange authorization code for tokens
    const { tokens } = await oauth2Client.getToken(code);
    oauth2Client.setCredentials(tokens);

    // Fetch user email to verify connected identity
    let connectedEmail: string | undefined;
    try {
      const oauth2 = google.oauth2({ version: 'v2', auth: oauth2Client });
      const userInfo = await oauth2.userinfo.get();
      connectedEmail = userInfo.data.email || undefined;
    } catch (userInfoErr) {
      console.warn('[calendar/callback] Could not fetch userinfo email:', userInfoErr);
    }

    const credentialsPayload: OAuthCredentials = {
      client_id: effectiveClientId,
      client_secret: effectiveClientSecret,
      refresh_token: tokens.refresh_token || undefined,
      access_token: tokens.access_token || undefined,
      expiry_date: tokens.expiry_date || undefined,
      email: connectedEmail,
    };

    const encryptedCredentials = encrypt(JSON.stringify(credentialsPayload));

    // Save configuration in Supabase scoped to this account
    const { error: saveErr } = await supabaseAdmin()
      .from('google_calendar_configs')
      .upsert(
        {
          account_id: accountId,
          created_by: userId,
          calendar_id: 'primary',
          auth_type: 'oauth',
          oauth_credentials: encryptedCredentials,
          is_active: true,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'account_id' },
      );

    if (saveErr) {
      console.error('[calendar/callback] Failed to persist OAuth config:', saveErr);
      return NextResponse.redirect(`${settingsUrl}&error=db_save_failed`);
    }

    console.log(`[calendar/callback] Google Calendar OAuth connected successfully for account ${accountId} (${connectedEmail || 'unknown'})`);
    return NextResponse.redirect(`${settingsUrl}&connected=google`);
  } catch (exchangeErr: unknown) {
    const msg = exchangeErr instanceof Error ? exchangeErr.message : String(exchangeErr);
    console.error('[calendar/callback] Token exchange error:', msg);
    return NextResponse.redirect(`${settingsUrl}&error=${encodeURIComponent(msg)}`);
  }
}
