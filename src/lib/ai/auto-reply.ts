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
import {
  extractEmailFromText,
  detectBookingIntent,
  loadCalendarConfig,
  executeDemoBooking,
} from '@/lib/calendar/booking-coordinator'
import {
  runAiActionPipeline,
  sanitizeCustomerResponse,
} from '@/lib/ai/actions/action-runner'
import { analyzeCustomerIntent } from '@/lib/ai/actions/intent-detector'
import type { ProductActionConfig, ProductKey } from '@/lib/ai/actions/types'

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

    // Check for Google Calendar Demo / Call booking intent with email
    const userMsg = latestUserMessage(messages)

    // Execute the Action System (CRM tagging, scoring, lead routing, milestone notes, calendar availability & booking)
    if (config.actionSystemEnabled !== false && userMsg) {
      try {
        const intents = analyzeCustomerIntent({ currentText: userMsg, messages })
        const hasActionIntent =
          intents.products.length > 0 ||
          intents.isReadyToBook ||
          intents.hasBothDateAndTime ||
          intents.isHumanHandoffRequested ||
          intents.stageTagsToAdd.length > 0 ||
          intents.signals.length > 0

        if (hasActionIntent) {
          let contact: { id: string; name?: string | null; phone?: string | null; email?: string | null; lead_score?: number; lead_temperature?: string | null } | null = null
          try {
            const { data: cData } = await db
              .from('contacts')
              .select('id, name, phone, email, lead_score, lead_temperature')
              .eq('id', contactId)
              .maybeSingle()
            contact = cData
          } catch {
            // Continue if contact lookup fails
          }

          const pipelineResult = await runAiActionPipeline({
            db,
            accountId,
            conversationId,
            contactId,
            configOwnerUserId,
            inboundText: userMsg,
            messages,
            aiConfig: config,
            productConfigs: config.productConfigs as Record<ProductKey, ProductActionConfig> | undefined,
            contactRecord: contact || undefined,
          })

          if (pipelineResult.isHandoff) {
            logDecision('AI_NO_RESPONSE', {
              conversationId,
              accountId,
              reason: 'action_pipeline_handoff',
            })
            const update: Record<string, unknown> = {
              ai_autoreply_disabled: true,
              ai_handoff_summary: pipelineResult.crmNoteCreated || 'Human handoff requested by customer.',
            }
            if (pipelineResult.assignedAgentId) {
              update.assigned_agent_id = pipelineResult.assignedAgentId
            } else if (config.handoffAgentId && !conv.assigned_agent_id) {
              update.assigned_agent_id = config.handoffAgentId
            }
            await db.from('conversations').update(update).eq('id', conversationId)

            const { data: claimed } = await db.rpc('claim_ai_reply_slot', {
              conversation_id: conversationId,
              max_replies: config.autoReplyMaxPerConversation,
            })
            if (claimed === true && pipelineResult.customerResponse) {
              await engineSendText({
                accountId,
                userId: configOwnerUserId,
                conversationId,
                contactId,
                text: pipelineResult.customerResponse,
                aiGenerated: true,
              })
            }
            return
          }

          // If action pipeline resolved a specific grounded response (booked appointment, slots offer, product demo offer, etc.)
          if (
            pipelineResult.customerResponse &&
            (pipelineResult.calendarResult || pipelineResult.productKey || pipelineResult.crmNoteCreated)
          ) {
            const { data: claimed, error: claimErr } = await db.rpc('claim_ai_reply_slot', {
              conversation_id: conversationId,
              max_replies: config.autoReplyMaxPerConversation,
            })
            if (claimed === true && !claimErr) {
              await engineSendText({
                accountId,
                userId: configOwnerUserId,
                conversationId,
                contactId,
                text: sanitizeCustomerResponse(pipelineResult.customerResponse),
                aiGenerated: true,
              })

              logDecision('AI_RESPONDED', {
                conversationId,
                accountId,
                action: 'action_pipeline_responded',
                product: pipelineResult.productKey,
              })
              return
            }
          }
        }
      } catch (actionErr) {
        console.warn('[ai auto-reply] action pipeline non-fatal error, falling back to LLM:', actionErr)
      }
    }

    // Fallback: Check for Google Calendar Demo / Call booking intent with email if action pipeline didn't consume
    const extractedEmail = userMsg ? extractEmailFromText(userMsg) : null
    if (extractedEmail) {
      const recentAssistantTexts = messages
        .filter((m) => m.role === 'assistant')
        .map((m) => m.content)
      const hasIntent = detectBookingIntent(userMsg, recentAssistantTexts)

      if (hasIntent) {
        const calConfig = await loadCalendarConfig(db, accountId)
        if (!calConfig || calConfig.auto_booking_enabled !== false) {
          const { data: claimed } = await db.rpc('claim_ai_reply_slot', {
            conversation_id: conversationId,
            max_replies: config.autoReplyMaxPerConversation,
          })

          if (claimed === true) {
            const bookingResult = await executeDemoBooking({
              db,
              accountId,
              contactId,
              conversationId,
              configOwnerUserId,
              email: extractedEmail,
              preferredTimeText: userMsg,
              bookedBy: 'ai',
              sendWhatsAppConfirmation: true,
            })

            logDecision('AI_RESPONDED', {
              conversationId,
              accountId,
              action: 'calendar_demo_booked',
              email: extractedEmail,
              bookingId: bookingResult.booking?.id,
            })
            return
          }
        }
      }
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
      text: sanitizeCustomerResponse(text),
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
