import { NextResponse } from 'next/server';
import crypto from 'crypto';
import { requireRole, toErrorResponse } from '@/lib/auth/account';
import { encrypt } from '@/lib/whatsapp/encryption';
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit';

export async function GET(request: Request) {
  try {
    const { accountId, userId } = await requireRole('admin');

    const limit = checkRateLimit(`cal-auth:${userId}`, RATE_LIMITS.adminAction);
    if (!limit.success) return rateLimitResponse(limit);

    const { searchParams } = new URL(request.url);
    const clientId = searchParams.get('client_id') || process.env.GOOGLE_CLIENT_ID;
    const clientSecret = searchParams.get('client_secret') || process.env.GOOGLE_CLIENT_SECRET;

    if (!clientId) {
      return NextResponse.json(
        {
          error:
            'Google Client ID is not configured. Please set GOOGLE_CLIENT_ID in your environment or provide it in settings.',
        },
        { status: 400 },
      );
    }

    const host = request.headers.get('host') || 'localhost:3000';
    const proto = request.headers.get('x-forwarded-proto') || (host.startsWith('localhost') ? 'http' : 'https');
    const baseUrl = process.env.NEXT_PUBLIC_SITE_URL || `${proto}://${host}`;
    const redirectUri = `${baseUrl}/api/calendar/callback`;

    // Secure encrypted state token with CSRF protection and timestamp expiration (15 mins)
    const statePayload = {
      accountId,
      userId,
      clientId,
      clientSecret: clientSecret || null,
      timestamp: Date.now(),
      nonce: crypto.randomBytes(16).toString('hex'),
    };
    const state = encrypt(JSON.stringify(statePayload));

    const { google } = await import('googleapis');
    const oauth2Client = new google.auth.OAuth2(clientId, clientSecret || undefined, redirectUri);

    const authUrl = oauth2Client.generateAuthUrl({
      access_type: 'offline',
      prompt: 'consent', // Ensures refresh_token is always returned
      scope: [
        'https://www.googleapis.com/auth/calendar',
        'https://www.googleapis.com/auth/calendar.events',
        'https://www.googleapis.com/auth/userinfo.email',
      ],
      state,
    });

    const wantsJson = request.headers.get('accept')?.includes('application/json');
    if (wantsJson) {
      return NextResponse.json({ url: authUrl });
    }

    return NextResponse.redirect(authUrl);
  } catch (err) {
    return toErrorResponse(err);
  }
}
