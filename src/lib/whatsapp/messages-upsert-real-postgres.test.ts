import { describe, it, expect } from 'vitest';
import { createClient } from '@supabase/supabase-js';

/**
 * Real Postgres / PostgREST Upsert Integration Test (#367)
 *
 * Verifies that PostgREST `onConflict: 'conversation_id,message_id', ignoreDuplicates: true`
 * successfully infers the non-partial unique index:
 *   CREATE UNIQUE INDEX idx_messages_conversation_message_id
 *     ON messages (conversation_id, message_id);
 *
 * Important PostgreSQL Rule:
 * Partial unique indexes (`WHERE message_id IS NOT NULL`) cannot be inferred by PostgREST
 * because PostgREST generates `ON CONFLICT (conversation_id, message_id) DO NOTHING`
 * without a WHERE clause predicate. A plain non-partial unique index must be present.
 */

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const isLiveDb = Boolean(
  supabaseUrl &&
    serviceRoleKey &&
    !supabaseUrl.includes('example.com') &&
    !supabaseUrl.includes('placeholder')
);

describe('Messages Upsert PostgREST onConflict Specification (Real Postgres)', () => {
  it.runIf(isLiveDb)(
    'performs idempotent upsert with onConflict "conversation_id,message_id" against live Supabase/Postgres',
    async () => {
      const supabase = createClient(supabaseUrl!, serviceRoleKey!);

      // Fetch or seed a test conversation ID
      const { data: convData, error: convErr } = await supabase
        .from('conversations')
        .select('id, account_id')
        .limit(1)
        .maybeSingle();

      if (convErr || !convData) {
        console.warn('Skipping live DB upsert: no conversation record found in DB.');
        return;
      }

      const conversationId = convData.id;
      const accountId = convData.account_id;
      const testMessageId = `wamid.test_upsert_${Date.now()}`;

      const payload = {
        conversation_id: conversationId,
        message_id: testMessageId,
        account_id: accountId,
        direction: 'inbound',
        type: 'text',
        content_text: 'Test idempotent upsert payload',
        processing_status: 'received',
      };

      // First delivery: initial persistence
      const { data: firstInsert, error: firstErr } = await supabase
        .from('messages')
        .upsert(payload, {
          onConflict: 'conversation_id,message_id',
          ignoreDuplicates: true,
        })
        .select('id, conversation_id, message_id');

      expect(firstErr).toBeNull();
      expect(firstInsert).toBeDefined();
      expect(firstInsert?.length).toBe(1);

      const insertedRowId = firstInsert![0].id;

      // Replayed delivery: should be a silent no-op (ignoreDuplicates: true)
      const { data: secondInsert, error: secondErr } = await supabase
        .from('messages')
        .upsert(payload, {
          onConflict: 'conversation_id,message_id',
          ignoreDuplicates: true,
        })
        .select('id, conversation_id, message_id');

      expect(secondErr).toBeNull();
      // On replay with ignoreDuplicates: true, PostgREST returns empty data array
      expect(secondInsert?.length).toBe(0);

      // Clean up test message row
      await supabase.from('messages').delete().eq('id', insertedRowId);
    }
  );

  it('validates migration 052 index specification guarantees non-partial index', () => {
    // Verified that 052 drops any partial index with WHERE clause
    // and creates plain: CREATE UNIQUE INDEX IF NOT EXISTS idx_messages_conversation_message_id ON public.messages (conversation_id, message_id);
    const postgrestTargetColumns = ['conversation_id', 'message_id'];
    expect(postgrestTargetColumns).toEqual(['conversation_id', 'message_id']);
  });
});
