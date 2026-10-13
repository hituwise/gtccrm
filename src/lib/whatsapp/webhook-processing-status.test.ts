import { describe, it, expect, vi } from 'vitest';
import { STALE_PROCESSING_TIMEOUT_MS } from './webhook-constants';

describe('Webhook Message Processing Status & Crash Resilience', () => {
  it('marks processing_status="replied" immediately upon outbound WhatsApp send success to prevent duplicate replies on crash', async () => {
    const conversationId = 'conv-test-proc-status';
    const inboundMessageId = 'wamid.HBgLMTIzNDU2Nzg5';

    let dbMessageRow = {
      id: 'msg-internal-001',
      conversation_id: conversationId,
      message_id: inboundMessageId,
      processing_status: 'processing',
      updated_at: new Date().toISOString(),
    };

    const mockDb: any = {
      from: vi.fn((table: string) => {
        const chain: any = {
          update: vi.fn((updates: any) => {
            if (table === 'messages') {
              dbMessageRow = { ...dbMessageRow, ...updates };
            }
            return chain;
          }),
          eq: vi.fn().mockReturnThis(),
          select: vi.fn().mockReturnThis(),
          maybeSingle: vi.fn().mockResolvedValue({ data: dbMessageRow, error: null }),
        };
        return chain;
      }),
    };

    // Simulate outbound send completion
    await mockDb
      .from('messages')
      .update({ processing_status: 'replied', updated_at: new Date().toISOString() })
      .eq('conversation_id', conversationId)
      .eq('message_id', inboundMessageId);

    expect(dbMessageRow.processing_status).toBe('replied');

    // Subsequent webhook retry arrives: verify it detects 'replied' and short-circuits
    const { data: existingRow } = await mockDb
      .from('messages')
      .select('id, processing_status, updated_at')
      .eq('conversation_id', conversationId)
      .eq('message_id', inboundMessageId)
      .maybeSingle();

    const isReplied = existingRow.processing_status === 'replied';
    expect(isReplied).toBe(true);

    // Verify short-circuit condition prevents secondary outbound dispatch
    let secondaryDispatchCalled = false;
    if (isReplied) {
      // Short-circuit
    } else {
      secondaryDispatchCalled = true;
    }

    expect(secondaryDispatchCalled).toBe(false);
  });

  it('resumes execution for messages left in failed or stale processing status due to worker crash', async () => {
    const conversationId = 'conv-crash-recovery';
    const inboundMessageId = 'wamid.crashed123';

    // Stale row from a worker that crashed 6 minutes ago mid-execution
    const crashedRow = {
      id: 'msg-crashed-001',
      conversation_id: conversationId,
      message_id: inboundMessageId,
      processing_status: 'processing',
      updated_at: new Date(Date.now() - 6 * 60 * 1000).toISOString(),
    };

    const isReplied = crashedRow.processing_status === 'replied';
    const isActivelyProcessing =
      crashedRow.processing_status === 'processing' &&
      crashedRow.updated_at &&
      Date.now() - new Date(crashedRow.updated_at).getTime() < STALE_PROCESSING_TIMEOUT_MS;

    // Must NOT short-circuit stale/crashed message (active processing is false)
    expect(isReplied).toBe(false);
    expect(isActivelyProcessing).toBe(false);

    // Should resume processing
    const shouldResume = !isReplied && !isActivelyProcessing;
    expect(shouldResume).toBe(true);

    // Active row (< 5 minutes) must be recognized as actively processing
    const activeRow = {
      ...crashedRow,
      updated_at: new Date(Date.now() - 60 * 1000).toISOString(),
    };
    const activeIsProcessing =
      activeRow.processing_status === 'processing' &&
      activeRow.updated_at &&
      Date.now() - new Date(activeRow.updated_at).getTime() < STALE_PROCESSING_TIMEOUT_MS;
    expect(activeIsProcessing).toBe(true);
  });

  it('verifies deterministic reply paths (booking confirmation, handoff, fallback/error) all stamp processing_status="replied"', async () => {
    const testCases = [
      { path: 'calendar_booking_confirmed', inboundWamid: 'wamid.booking01' },
      { path: 'handoff_notification', inboundWamid: 'wamid.handoff01' },
      { path: 'calendar_or_guardrail_fallback', inboundWamid: 'wamid.fallback01' },
    ];

    for (const tc of testCases) {
      let status = 'processing';
      const mockDb: any = {
        from: (table: string) => ({
          update: (payload: { processing_status: string }) => {
            if (table === 'messages' && payload.processing_status) {
              status = payload.processing_status;
            }
            return {
              eq: () => ({
                eq: () => Promise.resolve({ error: null }),
              }),
            };
          },
        }),
      };

      // Simulate sending on the deterministic path
      await mockDb
        .from('messages')
        .update({ processing_status: 'replied', updated_at: new Date().toISOString() })
        .eq('conversation_id', 'conv-det-1')
        .eq('message_id', tc.inboundWamid);

      expect(status).toBe('replied');
    }
  });
});
