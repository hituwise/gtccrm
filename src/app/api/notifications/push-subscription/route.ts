import { NextResponse } from 'next/server';
import { getCurrentAccount, toErrorResponse } from '@/lib/auth/account';
import { getVapidPublicKey, sendTestPushNotification } from '@/lib/notifications/web-push-server';

export async function GET() {
  try {
    const ctx = await getCurrentAccount();
    const { count } = await ctx.supabase
      .from('push_subscriptions')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', ctx.userId)
      .eq('account_id', ctx.accountId);

    return NextResponse.json({
      vapidPublicKey: getVapidPublicKey(),
      isSubscribed: Boolean(count && count > 0),
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function POST(req: Request) {
  try {
    const ctx = await getCurrentAccount();
    const body = await req.json();

    // Check if this is a test push request
    if (body.action === 'test') {
      const testResult = await sendTestPushNotification(
        ctx.supabase,
        ctx.userId,
        ctx.accountId
      );
      return NextResponse.json(testResult);
    }

    const { endpoint, keys, userAgent } = body;
    if (!endpoint || !keys?.p256dh || !keys?.auth) {
      return NextResponse.json(
        { error: 'Invalid push subscription payload' },
        { status: 400 }
      );
    }

    // Upsert the subscription for this user and account
    const { error } = await ctx.supabase.from('push_subscriptions').upsert(
      {
        account_id: ctx.accountId,
        user_id: ctx.userId,
        endpoint,
        p256dh: keys.p256dh,
        auth: keys.auth,
        user_agent: userAgent || null,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'endpoint' }
    );

    if (error) {
      console.error('[push-subscription] Upsert failed:', error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function DELETE(req: Request) {
  try {
    const ctx = await getCurrentAccount();
    const body = await req.json().catch(() => ({}));
    const { endpoint } = body;

    let query = ctx.supabase
      .from('push_subscriptions')
      .delete()
      .eq('user_id', ctx.userId)
      .eq('account_id', ctx.accountId);

    if (endpoint) {
      query = query.eq('endpoint', endpoint);
    }

    const { error } = await query;
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    return toErrorResponse(err);
  }
}
