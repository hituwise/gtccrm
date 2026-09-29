import { describe, it, expect, vi, beforeEach } from 'vitest';
import webpush from 'web-push';
import {
  dispatchPushNotificationForInboundMessage,
  sendTestPushNotification,
  getVapidPublicKey,
} from './web-push-server';

vi.mock('web-push', () => ({
  default: {
    setVapidDetails: vi.fn(),
    sendNotification: vi.fn(),
  },
}));

describe('web-push-server', () => {
  const accountId = 'acc-1';
  const conversationId = 'conv-1';
  const userId = 'user-1';

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('exposes a valid VAPID public key', () => {
    const key = getVapidPublicKey();
    expect(key).toBeTruthy();
    expect(typeof key).toBe('string');
  });

  it('returns sentCount: 0 when no subscriptions exist', async () => {
    const db = {
      from: () => ({
        select: () => ({
          eq: () => Promise.resolve({ data: [], error: null }),
        }),
      }),
    } as unknown as Parameters<typeof dispatchPushNotificationForInboundMessage>[0];

    const result = await dispatchPushNotificationForInboundMessage(db, {
      accountId,
      conversationId,
      senderName: 'John Doe',
      contentText: 'Hello!',
    });

    expect(result.sentCount).toBe(0);
    expect(webpush.sendNotification).not.toHaveBeenCalled();
  });

  it('sends push notifications to registered subscriptions', async () => {
    vi.mocked(webpush.sendNotification).mockResolvedValue({} as never);

    const subscriptions = [
      {
        id: 'sub-1',
        endpoint: 'https://fcm.googleapis.com/fcm/send/token1',
        p256dh: 'p256-key-1',
        auth: 'auth-secret-1',
        user_id: userId,
      },
      {
        id: 'sub-2',
        endpoint: 'https://web.push.apple.com/token2',
        p256dh: 'p256-key-2',
        auth: 'auth-secret-2',
        user_id: 'user-2',
      },
    ];

    const db = {
      from: () => ({
        select: () => ({
          eq: () => Promise.resolve({ data: subscriptions, error: null }),
        }),
        delete: () => ({
          in: () => Promise.resolve({ error: null }),
        }),
      }),
    } as unknown as Parameters<typeof dispatchPushNotificationForInboundMessage>[0];

    const result = await dispatchPushNotificationForInboundMessage(db, {
      accountId,
      conversationId,
      senderName: 'Jane Lead',
      contentText: 'I want to buy your product',
    });

    expect(result.sentCount).toBe(2);
    expect(webpush.sendNotification).toHaveBeenCalledTimes(2);

    const firstCallPayload = JSON.parse(
      vi.mocked(webpush.sendNotification).mock.calls[0][1] as string
    );
    expect(firstCallPayload).toMatchObject({
      title: 'Jane Lead',
      body: 'I want to buy your product',
      icon: '/icon',
      tag: 'conv-conv-1',
      data: { url: '/inbox?c=conv-1' },
    });
  });

  it('prunes expired subscriptions (410 Gone)', async () => {
    const error410 = new Error('Subscription expired');
    (error410 as unknown as { statusCode: number }).statusCode = 410;

    vi.mocked(webpush.sendNotification).mockRejectedValueOnce(error410);

    const deletedIds: string[] = [];
    const db = {
      from: () => ({
        select: () => ({
          eq: () =>
            Promise.resolve({
              data: [
                {
                  id: 'sub-expired',
                  endpoint: 'https://fcm.googleapis.com/expired',
                  p256dh: 'k',
                  auth: 'a',
                  user_id: userId,
                },
              ],
              error: null,
            }),
        }),
        delete: () => ({
          in: (_col: string, ids: string[]) => {
            deletedIds.push(...ids);
            return Promise.resolve({ error: null });
          },
        }),
      }),
    } as unknown as Parameters<typeof dispatchPushNotificationForInboundMessage>[0];

    const result = await dispatchPushNotificationForInboundMessage(db, {
      accountId,
      conversationId,
      senderName: 'Test',
      contentText: 'Test msg',
    });

    expect(result.sentCount).toBe(0);
    expect(deletedIds).toContain('sub-expired');
  });

  it('sends test push notification for a user', async () => {
    vi.mocked(webpush.sendNotification).mockResolvedValue({} as never);

    const db = {
      from: () => ({
        select: () => ({
          eq: () => ({
            eq: () =>
              Promise.resolve({
                data: [
                  {
                    id: 'sub-user-1',
                    endpoint: 'https://fcm.googleapis.com/test',
                    p256dh: 'k',
                    auth: 'a',
                    user_id: userId,
                  },
                ],
                error: null,
              }),
          }),
        }),
        delete: () => ({ in: () => Promise.resolve({ error: null }) }),
      }),
    } as unknown as Parameters<typeof sendTestPushNotification>[0];

    const result = await sendTestPushNotification(db, userId, accountId);
    expect(result.success).toBe(true);
    expect(result.sentCount).toBe(1);
    expect(webpush.sendNotification).toHaveBeenCalledTimes(1);
  });
});
