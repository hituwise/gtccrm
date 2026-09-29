import { supabaseAdmin } from './admin-client'
import { loadAiConfig } from './config'
import { buildConversationContext } from './context'
import { retrieveKnowledge } from './knowledge'
import { generateReply } from './generate'
import { buildSystemPrompt } from './defaults'
import { buildHandoffSummary } from './handoff'
import { logAiUsage } from './usage'
import { latestUserMessage } from './query'
import {
  engineSendText,
  loadAccountMetaCredentials,
} from '@/lib/flows/meta-send'
import { sendTypingIndicator } from '@/lib/whatsapp/meta-api'
import { checkRateLimit, RATE_LIMITS } from '@/lib/rate-limit'

import { logDecision } from './decision-logger'

interface DispatchArgs {
  /** Tenancy key — drives config, contact, and whatsapp_config lookups. */
  accountId: string
  conversationId: string
  contactId: string
  /** The account's WhatsApp config owner, used for the outbound send's
   *  audit columns (mirrors how the flow runner passes it through). */
  configOwnerUserId: string
  /** Meta's wamid of the customer message we're replying to. When set,
   *  a typing indicator (which also marks it read) is shown while the
   *  reply is generated. Optional so older callers keep working. */
  inboundMessageId?: string
  /** Optional interactive reply identifier for button/list taps */
  interactiveReplyId?: string
  /** Optional interactive reply title/label */
  interactiveLabel?: string
}

/**
 * AI auto-reply for a freshly-arrived inbound message.
 *
 * Invoked from the WhatsApp webhook's `after()` block, when no
 * deterministic flow or automation consumed/replied to the message.
 *
 * Eligibility gates:
 *   - AI off / auto-reply disabled for the account
 *   - a human agent is assigned (they own the thread)
 *   - auto-reply was disabled for this conversation (prior handoff)
 *   - the per-conversation reply cap is reached
 *   - account-level rate limit
 *   - there's nothing to reply to
 */
export async function dispatchInboundToAiReply(
  args: DispatchArgs,
): Promise<void> {
  const {
    accountId,
    conversationId,
    contactId,
    configOwnerUserId,
    inboundMessageId,
  } = args

  try {
    const db = supabaseAdmin()

    const config = await loadAiConfig(db, accountId)
    if (!config || !config.autoReplyEnabled) {
      logDecision('AI_NO_RESPONSE', {
        conversationId,
        accountId,
        reason: 'auto_reply_disabled_or_unconfigured',
      })
      return
    }

    const { data: conv, error: convErr } = await db
      .from('conversations')
      .select('assigned_agent_id, ai_autoreply_disabled, ai_reply_count')
      .eq('id', conversationId)
      .maybeSingle()
    if (convErr || !conv) return

    // Human handoff is authoritative: if assigned_agent_id exists OR
    // ai_autoreply_disabled=true, do not invoke AI.
    if (conv.assigned_agent_id || conv.ai_autoreply_disabled) {
      logDecision('HUMAN_HANDOFF', {
        conversationId,
        accountId,
        assignedAgent: Boolean(conv.assigned_agent_id),
        reason: conv.assigned_agent_id ? 'agent_assigned' : 'autoreply_disabled',
      })
      return
    }

    // Per-conversation reply cap check
    if (conv.ai_reply_count >= config.autoReplyMaxPerConversation) {
      logDecision('AI_REPLY_LIMIT_REACHED', {
        conversationId,
        accountId,
        replyCount: conv.ai_reply_count,
        maxReplies: config.autoReplyMaxPerConversation,
        reason: 'pre_generation_cap_reached',
      })
      await db
        .from('conversations')
        .update({
          ai_autoreply_disabled: true,
          ai_handoff_summary: `AI reply limit reached (${config.autoReplyMaxPerConversation} replies max).`,
        })
        .eq('id', conversationId)
      return
    }

    const messages = await buildConversationContext(db, conversationId)
    if (messages.length === 0) {
      logDecision('AI_NO_RESPONSE', {
        conversationId,
        accountId,
        reason: 'empty_context',
      })
      return
    }

    // Account-wide throttle on the shared BYO key (30 replies/min safety limit).
    const acctLimit = checkRateLimit(
      `ai-autoreply:${accountId}`,
      RATE_LIMITS.aiAutoReplyAccount,
    )
    if (!acctLimit.success) {
      logDecision('AI_RATE_LIMITED', {
        accountId,
        conversationId,
        limit: RATE_LIMITS.aiAutoReplyAccount.limit,
      })
      return
    }

    // Show customer "typing…" while generating reply
    if (inboundMessageId) {
      await showTypingIndicator(db, accountId, inboundMessageId)
    }

    // Ground the reply in the account's knowledge base (best-effort).
    const knowledge = await retrieveKnowledge(
      db,
      accountId,
      config,
      latestUserMessage(messages),
    )

    const systemPrompt = buildSystemPrompt({
      userPrompt: config.systemPrompt,
      mode: 'auto_reply',
      knowledge,
    })

    const { text, handoff, usage } = await generateReply({
      config,
      systemPrompt,
      messages,
    })

    void logAiUsage(db, {
      accountId,
      conversationId,
      mode: 'auto_reply',
      provider: config.provider,
      model: config.model,
      usage,
    })

    if (handoff || !text) {
      logDecision('AI_NO_RESPONSE', {
        conversationId,
        accountId,
        reason: 'model_handoff',
      })
      const summary = buildHandoffSummary({
        messages,
        replyCount: conv.ai_reply_count ?? 0,
      })
      const update: Record<string, unknown> = {
        ai_autoreply_disabled: true,
        ai_handoff_summary: summary,
      }
      if (config.handoffAgentId && !conv.assigned_agent_id) {
        update.assigned_agent_id = config.handoffAgentId
      }
      await db.from('conversations').update(update).eq('id', conversationId)
      return
    }

    // Atomically claim a reply slot
    const { data: claimed, error: claimErr } = await db.rpc(
      'claim_ai_reply_slot',
      {
        conversation_id: conversationId,
        max_replies: config.autoReplyMaxPerConversation,
      },
    )
    if (claimErr) {
      logDecision('AI_NO_RESPONSE', {
        conversationId,
        accountId,
        reason: 'claim_rpc_failed',
      })
      console.error('[ai auto-reply] claim_ai_reply_slot failed:', claimErr)
      return
    }
    if (claimed !== true) {
      logDecision('AI_REPLY_LIMIT_REACHED', {
        conversationId,
        accountId,
        maxReplies: config.autoReplyMaxPerConversation,
        reason: 'claim_slot_exhausted',
      })
      await db
        .from('conversations')
        .update({
          ai_autoreply_disabled: true,
          ai_handoff_summary: `AI reply limit reached (${config.autoReplyMaxPerConversation} replies max).`,
        })
        .eq('id', conversationId)
      return
    }

    await engineSendText({
      accountId,
      userId: configOwnerUserId,
      conversationId,
      contactId,
      text,
      aiGenerated: true,
    })

    logDecision('AI_RESPONDED', { conversationId, accountId })
  } catch (err) {
    console.error('[ai auto-reply] dispatch failed:', err)
  }
}

/**
 * Best-effort "typing…" for the inbound we're about to answer. Swallows
 * every failure (no WhatsApp config, bad token, Meta 4xx) with a warning
 * — the indicator is cosmetic, the reply is not.
 */
async function showTypingIndicator(
  db: ReturnType<typeof supabaseAdmin>,
  accountId: string,
  inboundMessageId: string,
): Promise<void> {
  try {
    const { phoneNumberId, accessToken } = await loadAccountMetaCredentials(
      db,
      accountId,
    )
    await sendTypingIndicator({
      phoneNumberId,
      accessToken,
      messageId: inboundMessageId,
    })
  } catch (err) {
    console.warn('[ai auto-reply] typing indicator failed (continuing):', err)
  }
}
