import { describe, it, expect, vi, beforeEach } from 'vitest'
import { isOptOutMessage } from '@/lib/whatsapp/compliance'
import { logDecision } from '@/lib/ai/decision-logger'
import type { AiConfig } from '@/lib/ai/types'

// Hoisted state for vitest mocks
const h = vi.hoisted(() => ({
  loadAiConfig: vi.fn(),
  buildConversationContext: vi.fn(),
  retrieveKnowledge: vi.fn(),
  generateReply: vi.fn(),
  engineSendText: vi.fn(),
  sendTypingIndicator: vi.fn(),
  checkRateLimit: vi.fn(),
  runAutomationsForTrigger: vi.fn(),
  dispatchInboundToFlows: vi.fn(),
  consoleLogs: [] as string[],
  state: {
    conv: null as Record<string, unknown> | null,
    claimResult: true as boolean,
    claimError: null as { message: string } | null,
    updatePayload: null as Record<string, unknown> | null,
    rpcCalls: [] as { name: string; args: unknown }[],
  },
}))

vi.mock('@/lib/ai/config', () => ({
  loadAiConfig: h.loadAiConfig,
}))

vi.mock('@/lib/ai/context', () => ({
  buildConversationContext: h.buildConversationContext,
}))

vi.mock('@/lib/ai/knowledge', () => ({
  retrieveKnowledge: h.retrieveKnowledge,
}))

vi.mock('@/lib/ai/generate', () => ({
  generateReply: h.generateReply,
}))

vi.mock('@/lib/flows/meta-send', () => ({
  engineSendText: h.engineSendText,
  loadAccountMetaCredentials: vi.fn().mockResolvedValue({
    accessToken: 'test-token',
    phoneNumberId: 'pn-1',
  }),
}))

vi.mock('@/lib/whatsapp/meta-api', () => ({
  sendTypingIndicator: h.sendTypingIndicator,
}))

vi.mock('@/lib/rate-limit', () => ({
  checkRateLimit: h.checkRateLimit,
  RATE_LIMITS: {
    aiAutoReplyAccount: { limit: 30, windowMs: 60_000 },
  },
}))

vi.mock('@/lib/ai/admin-client', () => ({
  supabaseAdmin: () => ({
    from: (table: string) => {
      if (table === 'conversations') {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: () =>
                Promise.resolve({ data: h.state.conv, error: null }),
            }),
          }),
          update: (payload: Record<string, unknown>) => {
            h.state.updatePayload = payload
            return {
              eq: () => Promise.resolve({ error: null }),
            }
          },
        }
      }
      return {
        select: () => ({ eq: () => Promise.resolve({ data: [], error: null }) }),
        insert: () => Promise.resolve({ error: null }),
      }
    },
    rpc: (name: string, args: unknown) => {
      h.state.rpcCalls.push({ name, args })
      return Promise.resolve({
        data: h.state.claimResult,
        error: h.state.claimError,
      })
    },
  }),
}))

import { dispatchInboundToAiReply } from './auto-reply'

function makeAiConfig(overrides: Partial<AiConfig> = {}): AiConfig {
  return {
    provider: 'openai',
    model: 'gpt-4o-mini',
    apiKey: 'sk-test-key',
    systemPrompt: 'You are a helpful assistant.',
    isActive: true,
    autoReplyEnabled: true,
    autoReplyMaxPerConversation: 5,
    handoffAgentId: null,
    embeddingsApiKey: null,
    ...overrides,
  }
}

/**
 * Orchestrator simulation representing the inbound webhook execution in route.ts:
 * Compliance -> Flow -> Automations -> AI Auto-reply
 */
async function orchestrateInboundMessage(params: {
  accountId: string
  conversationId: string
  contactId: string
  configOwnerUserId: string
  inboundMessageId: string
  inboundText: string
  interactiveReplyId?: string
  interactiveLabel?: string
  isBroadcastReply?: boolean
  flowConsumed?: boolean
  automationResult?: { sentCustomerMessage: boolean }
}) {
  const {
    accountId,
    conversationId,
    contactId,
    configOwnerUserId,
    inboundMessageId,
    inboundText,
    interactiveReplyId,
    interactiveLabel,
    flowConsumed = false,
    automationResult = { sentCustomerMessage: false },
  } = params

  // 1. Compliance
  const isOptOut = isOptOutMessage(inboundText)
  if (isOptOut) {
    logDecision('AI_COMPLIANCE_BLOCKED', {
      conversationId,
      accountId,
      contactId,
      reason: 'compliance_opt_out',
    })
    return { step: 'compliance_blocked' }
  }

  // 2. Flow processing
  if (flowConsumed) {
    logDecision('FLOW_CONSUMED', {
      conversationId,
      accountId,
    })
    return { step: 'flow_consumed' }
  }

  // 3. Automations
  let automationReplied = false
  if (automationResult.sentCustomerMessage) {
    automationReplied = true
  }

  // 4. AI Evaluation
  if (automationReplied) {
    logDecision('AI_NO_RESPONSE', {
      conversationId,
      accountId,
      reason: 'automation_replied',
    })
    return { step: 'automation_replied' }
  }

  if (inboundText.trim() || interactiveReplyId) {
    await dispatchInboundToAiReply({
      accountId,
      conversationId,
      contactId,
      configOwnerUserId,
      inboundMessageId,
      interactiveReplyId,
      interactiveLabel,
    })
    return { step: 'ai_evaluated' }
  }

  return { step: 'no_action' }
}

describe('Inbound Message Orchestration — Coexistence Suite', () => {
  const accountId = 'acc-test-1'
  const conversationId = 'conv-test-1'
  const contactId = 'contact-test-1'
  const configOwnerUserId = 'user-test-1'
  const inboundMessageId = 'wamid.inbound-123'

  beforeEach(() => {
    vi.clearAllMocks()
    h.consoleLogs = []
    vi.spyOn(console, 'info').mockImplementation((...args) => {
      h.consoleLogs.push(args.join(' '))
    })
    vi.spyOn(console, 'warn').mockImplementation((...args) => {
      h.consoleLogs.push(args.join(' '))
    })

    h.state.conv = {
      id: conversationId,
      assigned_agent_id: null,
      ai_autoreply_disabled: false,
      ai_reply_count: 0,
    }
    h.state.claimResult = true
    h.state.claimError = null
    h.state.updatePayload = null
    h.state.rpcCalls = []

    h.loadAiConfig.mockResolvedValue(makeAiConfig())
    h.buildConversationContext.mockResolvedValue([
      { role: 'user', content: 'Hello there' },
    ])
    h.retrieveKnowledge.mockResolvedValue([])
    h.generateReply.mockResolvedValue({
      text: 'Hello! How can I help you today?',
      handoff: false,
      usage: { promptTokens: 10, completionTokens: 15, totalTokens: 25 },
    })
    h.engineSendText.mockResolvedValue({ id: 'wamid.out-1' })
    h.checkRateLimit.mockReturnValue({
      success: true,
      remaining: 29,
      reset: Date.now() + 60_000,
      limit: 30,
    })
  })

  // 1. Flow consumes expected input → AI does not reply
  it('1. Flow consumes expected input → AI does not reply', async () => {
    const result = await orchestrateInboundMessage({
      accountId,
      conversationId,
      contactId,
      configOwnerUserId,
      inboundMessageId,
      inboundText: 'YES',
      flowConsumed: true,
    })

    expect(result.step).toBe('flow_consumed')
    expect(h.engineSendText).not.toHaveBeenCalled()
    expect(h.consoleLogs.some((l) => l.includes('[AI_DECISION] [FLOW_CONSUMED]'))).toBe(true)
  })

  // 2. Flow does not consume normal text → AI replies
  it('2. Flow does not consume normal text → AI replies', async () => {
    const result = await orchestrateInboundMessage({
      accountId,
      conversationId,
      contactId,
      configOwnerUserId,
      inboundMessageId,
      inboundText: 'What are your store hours?',
      flowConsumed: false,
    })

    expect(result.step).toBe('ai_evaluated')
    expect(h.engineSendText).toHaveBeenCalledWith(
      expect.objectContaining({
        accountId,
        conversationId,
        text: 'Hello! How can I help you today?',
        aiGenerated: true,
      }),
    )
    expect(h.consoleLogs.some((l) => l.includes('[AI_DECISION] [AI_RESPONDED]'))).toBe(true)
  })

  // 3. Active automation exists → AI still replies
  it('3. Active automation exists → AI still replies', async () => {
    // Active automations do NOT disable AI account-wide
    const result = await orchestrateInboundMessage({
      accountId,
      conversationId,
      contactId,
      configOwnerUserId,
      inboundMessageId,
      inboundText: 'Can I get pricing?',
      flowConsumed: false,
      automationResult: { sentCustomerMessage: false },
    })

    expect(result.step).toBe('ai_evaluated')
    expect(h.engineSendText).toHaveBeenCalledTimes(1)
    expect(h.consoleLogs.some((l) => l.includes('[AI_DECISION] [AI_RESPONDED]'))).toBe(true)
  })

  // 4. Automation adds tag + AI replies
  it('4. Automation adds tag + AI replies', async () => {
    // Automation executes tag action (sentCustomerMessage is false)
    logDecision('AUTOMATION_EXECUTED', {
      automationId: 'auto-tag-lead',
      triggerType: 'new_message_received',
      outcome: 'tag_added',
    })

    const result = await orchestrateInboundMessage({
      accountId,
      conversationId,
      contactId,
      configOwnerUserId,
      inboundMessageId,
      inboundText: 'I am interested in your software',
      flowConsumed: false,
      automationResult: { sentCustomerMessage: false }, // tag added, but no outbound text
    })

    expect(result.step).toBe('ai_evaluated')
    expect(h.consoleLogs.some((l) => l.includes('[AI_DECISION] [AUTOMATION_EXECUTED]'))).toBe(true)
    expect(h.engineSendText).toHaveBeenCalledTimes(1)
    expect(h.consoleLogs.some((l) => l.includes('[AI_DECISION] [AI_RESPONDED]'))).toBe(true)
  })

  // 5. Human assignment → AI does not reply
  it('5. Human assignment → AI does not reply', async () => {
    h.state.conv = {
      id: conversationId,
      assigned_agent_id: 'agent-alice',
      ai_autoreply_disabled: false,
      ai_reply_count: 0,
    }

    const result = await orchestrateInboundMessage({
      accountId,
      conversationId,
      contactId,
      configOwnerUserId,
      inboundMessageId,
      inboundText: 'Hello human',
      flowConsumed: false,
    })

    expect(result.step).toBe('ai_evaluated')
    expect(h.engineSendText).not.toHaveBeenCalled()
    expect(
      h.consoleLogs.some(
        (l) => l.includes('[AI_DECISION] [HUMAN_HANDOFF]') && l.includes('reason=agent_assigned'),
      ),
    ).toBe(true)
  })

  // 6. Interactive button handled by flow → AI does not duplicate reply
  it('6. Interactive button handled by flow → AI does not duplicate reply', async () => {
    const result = await orchestrateInboundMessage({
      accountId,
      conversationId,
      contactId,
      configOwnerUserId,
      inboundMessageId,
      inboundText: 'Schedule Demo',
      interactiveReplyId: 'BTN_DEMO',
      interactiveLabel: 'Schedule Demo',
      flowConsumed: true, // Flow handles the button click
    })

    expect(result.step).toBe('flow_consumed')
    expect(h.engineSendText).not.toHaveBeenCalled()
    expect(h.consoleLogs.some((l) => l.includes('[AI_DECISION] [FLOW_CONSUMED]'))).toBe(true)
  })

  // 7. Unhandled interactive event → AI can evaluate it
  it('7. Unhandled interactive event → AI can evaluate it', async () => {
    h.buildConversationContext.mockResolvedValueOnce([
      { role: 'user', content: '[Button: Explore Plans] payload: BTN_PLANS' },
    ])
    h.generateReply.mockResolvedValueOnce({
      text: 'We have Starter, Pro, and Enterprise plans.',
      handoff: false,
      usage: { promptTokens: 10, completionTokens: 12, totalTokens: 22 },
    })

    const result = await orchestrateInboundMessage({
      accountId,
      conversationId,
      contactId,
      configOwnerUserId,
      inboundMessageId,
      inboundText: 'Explore Plans',
      interactiveReplyId: 'BTN_PLANS',
      interactiveLabel: 'Explore Plans',
      flowConsumed: false, // Flow does not handle this button
      automationResult: { sentCustomerMessage: false }, // Automations do not handle it
    })

    expect(result.step).toBe('ai_evaluated')
    expect(h.engineSendText).toHaveBeenCalledWith(
      expect.objectContaining({
        text: 'We have Starter, Pro, and Enterprise plans.',
        aiGenerated: true,
      }),
    )
    expect(h.consoleLogs.some((l) => l.includes('[AI_DECISION] [AI_RESPONDED]'))).toBe(true)
  })

  // 8. AI reply limit → AI blocked with explicit reason
  it('8. AI reply limit → AI blocked with explicit reason', async () => {
    // Conversation has reached the cap
    h.state.conv = {
      id: conversationId,
      assigned_agent_id: null,
      ai_autoreply_disabled: false,
      ai_reply_count: 5,
    }
    h.loadAiConfig.mockResolvedValueOnce(
      makeAiConfig({ autoReplyMaxPerConversation: 5 }),
    )

    await orchestrateInboundMessage({
      accountId,
      conversationId,
      contactId,
      configOwnerUserId,
      inboundMessageId,
      inboundText: 'Can you answer another question?',
      flowConsumed: false,
    })

    expect(h.engineSendText).not.toHaveBeenCalled()
    expect(
      h.consoleLogs.some(
        (l) =>
          l.includes('[AI_DECISION] [AI_REPLY_LIMIT_REACHED]') &&
          l.includes('reason=pre_generation_cap_reached'),
      ),
    ).toBe(true)
    // Exposes paused state in UI
    expect(h.state.updatePayload).toMatchObject({
      ai_autoreply_disabled: true,
      ai_handoff_summary: expect.stringContaining('AI reply limit reached'),
    })
  })

  // 9. Account rate limit → AI blocked with explicit reason
  it('9. Account rate limit → AI blocked with explicit reason', async () => {
    h.checkRateLimit.mockReturnValueOnce({
      success: false,
      remaining: 0,
      reset: Date.now() + 45_000,
      limit: 30,
    })

    await orchestrateInboundMessage({
      accountId,
      conversationId,
      contactId,
      configOwnerUserId,
      inboundMessageId,
      inboundText: 'Fast message',
      flowConsumed: false,
    })

    expect(h.engineSendText).not.toHaveBeenCalled()
    expect(
      h.consoleLogs.some(
        (l) => l.includes('[AI_DECISION] [AI_RATE_LIMITED]') && l.includes('limit=30'),
      ),
    ).toBe(true)
  })

  // 10. Compliance opt-out → AI blocked
  it('10. Compliance opt-out → AI blocked', async () => {
    const result = await orchestrateInboundMessage({
      accountId,
      conversationId,
      contactId,
      configOwnerUserId,
      inboundMessageId,
      inboundText: 'STOP',
      flowConsumed: false,
    })

    expect(result.step).toBe('compliance_blocked')
    expect(h.engineSendText).not.toHaveBeenCalled()
    expect(
      h.consoleLogs.some((l) => l.includes('[AI_DECISION] [AI_COMPLIANCE_BLOCKED]')),
    ).toBe(true)
  })

  // 11. claim_ai_reply_slot succeeds
  it('11. claim_ai_reply_slot succeeds', async () => {
    h.state.claimResult = true
    h.state.conv = {
      id: conversationId,
      assigned_agent_id: null,
      ai_autoreply_disabled: false,
      ai_reply_count: 2,
    }
    h.loadAiConfig.mockResolvedValueOnce(
      makeAiConfig({ autoReplyMaxPerConversation: 5 }),
    )

    await orchestrateInboundMessage({
      accountId,
      conversationId,
      contactId,
      configOwnerUserId,
      inboundMessageId,
      inboundText: 'Valid inquiry',
      flowConsumed: false,
    })

    expect(h.state.rpcCalls).toContainEqual({
      name: 'claim_ai_reply_slot',
      args: {
        conversation_id: conversationId,
        max_replies: 5,
      },
    })
    expect(h.engineSendText).toHaveBeenCalledTimes(1)
    expect(h.consoleLogs.some((l) => l.includes('[AI_DECISION] [AI_RESPONDED]'))).toBe(true)
  })

  // 12. Broadcast reply followed by AI response works
  it('12. Broadcast reply followed by AI response works', async () => {
    // Inbound reply to a broadcast campaign where flow does not consume
    const result = await orchestrateInboundMessage({
      accountId,
      conversationId,
      contactId,
      configOwnerUserId,
      inboundMessageId,
      inboundText: 'Hi, I received your special offer broadcast and want more details.',
      isBroadcastReply: true,
      flowConsumed: false,
      automationResult: { sentCustomerMessage: false },
    })

    expect(result.step).toBe('ai_evaluated')
    expect(h.engineSendText).toHaveBeenCalledWith(
      expect.objectContaining({
        accountId,
        conversationId,
        aiGenerated: true,
      }),
    )
    expect(h.consoleLogs.some((l) => l.includes('[AI_DECISION] [AI_RESPONDED]'))).toBe(true)
  })
})
