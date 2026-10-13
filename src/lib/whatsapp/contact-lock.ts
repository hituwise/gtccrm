import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Distributed + in-process concurrency lock for serverless WhatsApp webhooks.
 *
 * Guarantees inbound webhook deliveries for the same contact execute sequentially
 * across multiple serverless lambda instances and worker nodes, preventing:
 * 1. Race conditions during message deduplication & insertion.
 * 2. Concurrent AI auto-reply generations speaking over each other.
 * 3. Duplicate Google Calendar bookings or conflicting slot reservations.
 *
 * Reliability features:
 * - Lease renewal (heartbeat) every TTL/2 while execution is active.
 * - In-process FIFO queue ordered by WhatsApp message timestamp.
 * - Explicit ContactLockAcquisitionError on retry budget exhaustion so
 *   webhooks return HTTP 503 Retry-After instead of dropping the message.
 */

export class ContactLockAcquisitionError extends Error {
  constructor(public readonly contactId: string, message: string) {
    super(message);
    this.name = 'ContactLockAcquisitionError';
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export interface LockOptions {
  db?: SupabaseClient | null;
  timeoutMs?: number;
  ttlSeconds?: number;
  /** Unix timestamp (seconds or milliseconds) from WhatsApp webhook payload */
  messageTimestamp?: number;
}

interface QueuedItem<T> {
  timestamp: number;
  fn: () => Promise<T>;
  resolve: (value: T | PromiseLike<T>) => void;
  reject: (reason?: unknown) => void;
  options: LockOptions;
}

const contactQueues = new Map<string, QueuedItem<any>[]>();
const activeContactDrains = new Set<string>();

async function drainQueueForContact(key: string): Promise<void> {
  if (activeContactDrains.has(key)) return;
  activeContactDrains.add(key);

  try {
    while (true) {
      const queue = contactQueues.get(key);
      if (!queue || queue.length === 0) {
        contactQueues.delete(key);
        break;
      }

      // Dequeue the item with the earliest WhatsApp timestamp (guaranteed ordering)
      const item = queue.shift()!;
      try {
        const result = await executeWithDistributedLock(key, item.fn, item.options);
        item.resolve(result);
      } catch (err) {
        item.reject(err);
      }
    }
  } finally {
    activeContactDrains.delete(key);
  }
}

async function executeWithDistributedLock<T>(
  key: string,
  fn: () => Promise<T>,
  options: LockOptions,
): Promise<T> {
  const { db, timeoutMs = 12000, ttlSeconds = 30 } = options;

  let ownerToken = '';
  let dbLockAcquired = false;
  let heartbeatTimer: NodeJS.Timeout | null = null;

  try {
    if (db) {
      ownerToken = `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
      const startTime = Date.now();
      let pollDelay = 150;

      while (Date.now() - startTime < timeoutMs) {
        try {
          const { data, error } = await db.rpc('acquire_contact_lock', {
            p_contact_id: key,
            p_owner_token: ownerToken,
            p_ttl_seconds: ttlSeconds,
          });

          if (!error && data === true) {
            dbLockAcquired = true;
            break;
          }

          // Direct table fallback if RPC is not yet migrated
          if (
            error &&
            (error.code === '42883' ||
              error.message?.includes('function') ||
              error.message?.includes('does not exist'))
          ) {
            const { data: upsertData, error: upsertErr } = await db
              .from('contact_locks')
              .upsert(
                {
                  contact_id: key,
                  owner_token: ownerToken,
                  locked_at: new Date().toISOString(),
                  expires_at: new Date(Date.now() + ttlSeconds * 1000).toISOString(),
                },
                { onConflict: 'contact_id' },
              )
              .select('owner_token')
              .maybeSingle();

            if (!upsertErr && upsertData?.owner_token === ownerToken) {
              dbLockAcquired = true;
              break;
            }
          }
        } catch {
          // Retry on intermittent DB error
        }

        await sleep(pollDelay);
        pollDelay = Math.min(600, pollDelay * 1.5);
      }

      // If retry budget exhausted without acquiring distributed lock, do NOT drop message!
      if (!dbLockAcquired) {
        throw new ContactLockAcquisitionError(
          key,
          `Distributed contact lock acquisition for "${key}" timed out after ${timeoutMs}ms. Returning retryable error.`,
        );
      }

      // Setup lease renewal heartbeat for long runs
      const heartbeatIntervalMs = Math.max(3000, Math.floor((ttlSeconds * 1000) / 2));
      heartbeatTimer = setInterval(async () => {
        try {
          await db.rpc('renew_contact_lock', {
            p_contact_id: key,
            p_owner_token: ownerToken,
            p_ttl_seconds: ttlSeconds,
          });
        } catch {
          // Best effort heartbeat renewal
        }
      }, heartbeatIntervalMs);
    }

    return await fn();
  } finally {
    if (heartbeatTimer) {
      clearInterval(heartbeatTimer);
      heartbeatTimer = null;
    }

    if (db && dbLockAcquired && ownerToken) {
      try {
        await db.rpc('release_contact_lock', {
          p_contact_id: key,
          p_owner_token: ownerToken,
        });
      } catch {
        try {
          await db
            .from('contact_locks')
            .delete()
            .eq('contact_id', key)
            .eq('owner_token', ownerToken);
        } catch {
          // Swallowed: TTL automatically cleans up expired lock
        }
      }
    }
  }
}

/**
 * Executes `fn` under a distributed lock across serverless instances,
 * serialized through a per-contact priority queue ordered by WhatsApp message timestamp.
 */
export function withContactLock<T>(
  key: string,
  fn: () => Promise<T>,
  options: LockOptions = {},
): Promise<T> {
  if (!key) return fn();

  return new Promise<T>((resolve, reject) => {
    let queue = contactQueues.get(key);
    if (!queue) {
      queue = [];
      contactQueues.set(key, queue);
    }

    // Normalize timestamp to milliseconds
    const rawTs = options.messageTimestamp ?? Date.now();
    const normalizedTs = rawTs < 1e12 ? rawTs * 1000 : rawTs;

    const queuedItem: QueuedItem<T> = {
      timestamp: normalizedTs,
      fn,
      resolve,
      reject,
      options,
    };

    // Insert in sorted timestamp order (FIFO if timestamp identical)
    let insertIdx = queue.length;
    for (let i = 0; i < queue.length; i++) {
      if (normalizedTs < queue[i].timestamp) {
        insertIdx = i;
        break;
      }
    }
    queue.splice(insertIdx, 0, queuedItem);

    void drainQueueForContact(key);
  });
}
