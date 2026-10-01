import webpush from 'web-push';
import type { SupabaseClient } from '@supabase/supabase-js';

// Default VAPID keys for WACRM PWA notifications (can be overridden via env vars)
export const DEFAULT_VAPID_PUBLIC_KEY =
  'BMOui52S7f607EQeCjVrcClW2631wGmQ_jln_y7Duw7jY3cqTp4hNpYX_tmArjlsJbilbUgDPJtorsm95MSAGWs';
const DEFAULT_VAPID_PRIVATE_KEY =
  'MYML1dlhr3ZXgxNCxC6PBSS2gTS6_R6z2lxzcJ7j7fM';
const DEFAULT_VAPID_SUBJECT = 'mailto:admin@gtccrm.vercel.app';

export function getVapidPublicKey(): string {
  return process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY || DEFAULT_VAPID_PUBLIC_KEY;
}

function getVapidPrivateKey(): string {
  return process.env.VAPID_PRIVATE_KEY || DEFAULT_VAPID_PRIVATE_KEY;
}

function getVapidSubject(): string {
  return process.env.VAPID_SUBJECT || DEFAULT_VAPID_SUBJECT;
}

// Initialize VAPID configuration
function initVapid(): boolean {
  const publicKey = getVapidPublicKey();
  const privateKey = getVapidPrivateKey();
  const subject = getVapidSubject();

  if (!publicKey || !privateKey) {
    return false;
  }

  try {
    webpush.setVapidDetails(subject, publicKey, privateKey);
    return true;
  } catch (err) {
    console.error('[web-push] Failed to set VAPID details:', err);
    return false;
  }
}

export interface InboundPushNotificationParams {
  accountId: string;
  conversationId: string;
  senderName: string;
  contentText: string;
  assignedAgentId?: string | null;
}

/**
 * Dispatch mobile and desktop Web Push notifications for an inbound customer message.
 * Sends push to registered PWA devices for this account.
 */
export async function dispatchPushNotificationForInboundMessage(
  db: SupabaseClient,
  params: {
    accountId: string;
    conversationId: string;
    senderName: string;
    contentText: string;
    assignedAgentId?: string | null;
  }
): Promise<{ sentCount: number }> {
  if (!initVapid()) {
    return { sentCount: 0 };
  }

  const { accountId, conversationId, senderName, contentText, assignedAgentId } = params;

  try {
    // 1. Find target push subscriptions
    let query = db
      .from('push_subscriptions')
      .select('id, endpoint, p256dh, auth, user_id')
      .eq('account_id', accountId);

    // If an agent is assigned, notify that agent first; otherwise notify all account users
    if (assignedAgentId) {
      query = query.eq('user_id', assignedAgentId);
    }

    const { data: subscriptions, error } = await query;
    if (error || !subscriptions || subscriptions.length === 0) {
      // If assigned agent had no registered devices, fallback to all account devices
      if (assignedAgentId) {
        const { data: fallbackSubs } = await db
          .from('push_subscriptions')
          .select('id, endpoint, p256dh, auth, user_id')
          .eq('account_id', accountId);

        if (fallbackSubs && fallbackSubs.length > 0) {
          return sendToSubscriptions(db, fallbackSubs, {
            title: senderName || 'New WhatsApp Lead',
            body: contentText || 'New message received',
            conversationId,
          });
        }
      }
      return { sentCount: 0 };
    }

    return sendToSubscriptions(db, subscriptions, {
      title: senderName || 'New WhatsApp Lead',
      body: contentText || 'New message received',
      conversationId,
    });
  } catch (err) {
    console.error('[web-push] Dispatch failed:', err);
    return { sentCount: 0 };
  }
}

/**
 * Send a test push notification to a specific user's subscribed devices.
 */
export async function sendTestPushNotification(
  db: SupabaseClient,
  userId: string,
  accountId: string
): Promise<{ success: boolean; sentCount: number; message?: string }> {
  if (!initVapid()) {
    return { success: false, sentCount: 0, message: 'VAPID keys not configured' };
  }

  const { data: subscriptions, error } = await db
    .from('push_subscriptions')
    .select('id, endpoint, p256dh, auth, user_id')
    .eq('user_id', userId)
    .eq('account_id', accountId);

  if (error) {
    console.error('[web-push] query push_subscriptions error:', error);
    if (error.code === '42P01' || error.message?.includes('does not exist')) {
      return {
        success: false,
        sentCount: 0,
        message: 'Table "push_subscriptions" does not exist in Supabase. Please run the SQL in Supabase SQL Editor.',
      };
    }
    return {
      success: false,
      sentCount: 0,
      message: `Database error: ${error.message}`,
    };
  }

  if (!subscriptions || subscriptions.length === 0) {
    return {
      success: false,
      sentCount: 0,
      message: 'No push subscription found on this device. Please toggle the notification switch OFF and ON to register.',
    };
  }

  const result = await sendToSubscriptions(db, subscriptions, {
    title: '🔔 WACRM Notification Test',
    body: 'Success! Mobile & Desktop Push notifications are working perfectly on this device.',
    conversationId: 'test',
  });

  return {
    success: result.sentCount > 0,
    sentCount: result.sentCount,
  };
}

interface SubscriptionRow {
  id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
  user_id: string;
}

async function sendToSubscriptions(
  db: SupabaseClient,
  subscriptions: SubscriptionRow[],
  payloadData: { title: string; body: string; conversationId: string }
): Promise<{ sentCount: number }> {
  const payload = JSON.stringify({
    title: payloadData.title,
    body: payloadData.body,
    icon: '/icon-192.png',
    badge: '/icon-192.png',
    tag: `conv-${payloadData.conversationId}`,
    data: {
      url: payloadData.conversationId !== 'test' ? `/inbox?c=${payloadData.conversationId}` : '/inbox',
    },
  });

  let sentCount = 0;
  const expiredIds: string[] = [];

  for (const sub of subscriptions) {
    const pushSubscription = {
      endpoint: sub.endpoint,
      keys: {
        p256dh: sub.p256dh,
        auth: sub.auth,
      },
    };

    try {
      await webpush.sendNotification(pushSubscription, payload, {
        TTL: 60 * 60 * 24, // 24 hours
        urgency: 'high',
      });
      sentCount++;
    } catch (err: unknown) {
      const statusCode = (err as { statusCode?: number })?.statusCode;
      // 404 Not Found or 410 Gone means the subscription is no longer valid
      if (statusCode === 404 || statusCode === 410) {
        expiredIds.push(sub.id);
      } else {
        console.warn(`[web-push] Failed to send to ${sub.endpoint.slice(0, 30)}...:`, err);
      }
    }
  }

  // Prune expired subscriptions in the background
  if (expiredIds.length > 0) {
    await db.from('push_subscriptions').delete().in('id', expiredIds);
  }

  return { sentCount };
}
