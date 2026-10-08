import type { SupabaseClient } from '@supabase/supabase-js';
import type { AiActionEventType } from './types';

export interface LogAiActionArgs {
  db: SupabaseClient;
  accountId: string;
  contactId?: string | null;
  conversationId?: string | null;
  action: AiActionEventType;
  details?: Record<string, unknown>;
  source?: string;
}

/**
 * Persists an auditable action event to `ai_action_logs`.
 * Non-blocking / swallows write failures gracefully so action pipeline never fails
 * purely on logging.
 */
export async function logAiAction(args: LogAiActionArgs): Promise<void> {
  const {
    db,
    accountId,
    contactId = null,
    conversationId = null,
    action,
    details = {},
    source = 'ai_agent',
  } = args;

  try {
    const { error } = await db.from('ai_action_logs').insert({
      account_id: accountId,
      contact_id: contactId,
      conversation_id: conversationId,
      action,
      details,
      source,
    });

    if (error) {
      console.warn('[action-logger] Failed to insert ai_action_log:', error.message);
    }
  } catch (err) {
    console.warn('[action-logger] Unexpected error logging action:', err);
  }
}
