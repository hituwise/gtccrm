import { supabaseAdmin } from './admin-client'
import { loadAiConfig } from './config'
import { buildConversationContext } from './context'
import { retrieveKnowledge, buildContextualRetrievalQuery } from './knowledge'
import { generateReply } from './generate'
import {
  buildSystemPrompt,
  DEFAULT_NEUTRAL_FALLBACK_MESSAGE,
  DEFAULT_NEUTRAL_HANDOFF_MESSAGE,
} from './defaults'
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
  runAiActionPipeline,
  sanitizeCustomerResponse,
} from '@/lib/ai/actions/action-runner'
import { analyzeCustomerIntent } from '@/lib/ai/actions/intent-detector'
import type { ProductActionConfig, ProductKey } from '@/lib/ai/actions/types'
import { getTenantProducts } from '@/lib/products/tenant-products'
import { buildTenantAiSystemPrompt } from '@/lib/ai/tenant-prompt-builder'
import { validateReplyOutput } from '@/lib/ai/validate'
import { persistConversationState, getPersistedConversationState } from '@/lib/ai/conversation-state'

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

    // Load active tenant products/services for action routing and AI context
    const tenantCatalogue = await getTenantProducts(db, accountId, { fallbackToSeedIfGeniplus: true });
    let actionPipelineResult: Awaited<ReturnType<typeof runAiActionPipeline>> | undefined = undefined;

    // Execute the Action System (CRM tagging, scoring, lead routing, milestone notes, calendar availability & booking)
    if (config.actionSystemEnabled !== false && userMsg) {
      try {
        const intents = analyzeCustomerIntent({
          currentText: userMsg,
          messages,
          catalogue: tenantCatalogue.length > 0 ? tenantCatalogue : undefined,
        });
        const hasActionIntent =
          intents.products.length > 0 ||
          intents.isReadyToBook ||
          intents.hasBothDateAndTime ||
          intents.hasOnlyDate ||
          intents.hasOnlyTime ||
          Boolean(intents.email) ||
          Boolean(intents.customerName) ||
          Boolean(intents.explicitNameProvided) ||
          Boolean(intents.isSlotCheckOrReschedule) ||
          intents.isHumanHandoffRequested ||
          intents.stageTagsToAdd.length > 0 ||
          intents.signals.length > 0;

        if (hasActionIntent) {
          let contact: { id: string; name?: string | null; phone?: string | null; email?: string | null; lead_score?: number; lead_temperature?: string | null } | null = null;
          try {
            const { data: cData } = await db
              .from('contacts')
              .select('id, name, phone, email, lead_score, lead_temperature')
              .eq('id', contactId)
              .maybeSingle();
            contact = cData;
          } catch {
            // Continue if contact lookup fails
          }

          actionPipelineResult = await runAiActionPipeline({
            db,
            accountId,
            conversationId,
            contactId,
            configOwnerUserId,
            inboundText: userMsg,
            messages,
            aiConfig: config,
            productConfigs: tenantCatalogue,
            contactRecord: contact || undefined,
          });

          if (actionPipelineResult.isHandoff) {
            logDecision('AI_NO_RESPONSE', {
              conversationId,
              accountId,
              reason: 'action_pipeline_handoff',
            });
            const update: Record<string, unknown> = {
              ai_autoreply_disabled: true,
              ai_handoff_summary: actionPipelineResult.crmNoteCreated || 'Human handoff requested by customer.',
            };
            if (actionPipelineResult.assignedAgentId) {
              update.assigned_agent_id = actionPipelineResult.assignedAgentId;
            } else if (config.handoffAgentId && !conv.assigned_agent_id) {
              update.assigned_agent_id = config.handoffAgentId;
            }
            await db.from('conversations').update(update).eq('id', conversationId);

            const { data: claimed } = await db.rpc('claim_ai_reply_slot', {
              conversation_id: conversationId,
              max_replies: config.autoReplyMaxPerConversation,
            });
            if (claimed === true && actionPipelineResult.customerResponse) {
              await engineSendText({
                accountId,
                userId: configOwnerUserId,
                conversationId,
                contactId,
                text: actionPipelineResult.customerResponse,
                aiGenerated: true,
              });
              await markMessageReplied(db, conversationId, inboundMessageId);
            }
            return;
          }

          // ONLY send direct action response if an actual real Google Calendar booking or reschedule was executed
          const isConfirmedCalendarEvent =
            (actionPipelineResult.calendarResult?.action === 'book_appointment' && actionPipelineResult.calendarResult.success) ||
            (actionPipelineResult.calendarResult?.action === 'reschedule_appointment' && actionPipelineResult.calendarResult.success);

          if (isConfirmedCalendarEvent && actionPipelineResult.customerResponse) {
            const { data: claimed, error: claimErr } = await db.rpc('claim_ai_reply_slot', {
              conversation_id: conversationId,
              max_replies: config.autoReplyMaxPerConversation,
            });
            if (claimed === true && !claimErr) {
              await engineSendText({
                accountId,
                userId: configOwnerUserId,
                conversationId,
                contactId,
                text: sanitizeCustomerResponse(actionPipelineResult.customerResponse),
                aiGenerated: true,
              });

              await markMessageReplied(db, conversationId, inboundMessageId);

              await persistConversationState(db, accountId, contactId, conversationId, {
                lastBotMessage: actionPipelineResult.customerResponse,
              });

              logDecision('AI_RESPONDED', {
                conversationId,
                accountId,
                action: 'calendar_booking_confirmed',
                product: actionPipelineResult.productKey,
              });
              return;
            }
          }
        }
      } catch (actionErr) {
        console.warn('[ai auto-reply] action pipeline non-fatal error, falling back to LLM:', actionErr);
      }
    }

    // Show customer "typing…" while generating reply
    if (inboundMessageId) {
      await showTypingIndicator(db, accountId, inboundMessageId);
    }

    const persistedState = await getPersistedConversationState(db, conversationId);

    // Ground the reply in the account's knowledge base using contextual retrieval for short replies
    const retrievalQuery = buildContextualRetrievalQuery({
      latestUserText: latestUserMessage(messages),
      messages,
      currentTopic: (persistedState?.selectedProducts?.[0] || persistedState?.productKey) ?? null,
      selectedProducts: persistedState?.selectedProducts,
    });

    const knowledge = await retrieveKnowledge(
      db,
      accountId,
      config,
      retrievalQuery,
    );

    const tenantAiContext = await buildTenantAiSystemPrompt(
      db,
      accountId,
      config.systemPrompt,
    );

    // If calendar slots were looked up, supply them as grounded context for the LLM
    let calendarContext = '';
    if (actionPipelineResult?.calendarResult?.action === 'get_available_slots' && actionPipelineResult.calendarResult.slots?.length) {
      const slotList = actionPipelineResult.calendarResult.slots.map((s) => `• ${s.humanText}`).join('\n');
      calendarContext = `\n\n[AVAILABLE APPOINTMENT SLOTS FROM CALENDAR]:\n${slotList}\nPlease offer these specific slots politely and ask the customer which one works best for them.`;
    }

    const systemPrompt = buildSystemPrompt({
      userPrompt: tenantAiContext.systemPrompt + calendarContext,
      mode: 'auto_reply',
      knowledge,
    });

    const { text, handoff, usage } = await generateReply({
      config,
      systemPrompt,
      messages,
    });

    void logAiUsage(db, {
      accountId,
      conversationId,
      mode: 'auto_reply',
      provider: config.provider,
      model: config.model,
      usage,
    });

    if (handoff || !text) {
      logDecision('AI_NO_RESPONSE', {
        conversationId,
        accountId,
        reason: 'model_handoff',
      });
      const summary = buildHandoffSummary({
        messages,
        replyCount: conv.ai_reply_count ?? 0,
      });
      const update: Record<string, unknown> = {
        ai_autoreply_disabled: true,
        ai_handoff_summary: summary,
      };
      if (config.handoffAgentId && !conv.assigned_agent_id) {
        update.assigned_agent_id = config.handoffAgentId;
      }
      await db.from('conversations').update(update).eq('id', conversationId);
      return;
    }

    // Validate the generated reply against anti-repetition and anti-hallucination guardrails
    const lastAssistantMsg = messages.filter((m) => m.role === 'assistant').pop()?.content;
    let effectiveText = text;
    let validation = validateReplyOutput({
      draftText: effectiveText,
      lastBotMessage: lastAssistantMsg,
      tenantProducts: tenantCatalogue,
      toolResults: actionPipelineResult?.calendarResult,
      knowledgeExcerpts: knowledge,
    });

    if (!validation.isValid && validation.isRepetition) {
      console.info('[ai auto-reply] repetition detected, regenerating next step...');
      const retrySystemPrompt = `${systemPrompt}\n\n[CRITICAL]: Your previous draft repeated the prior message: "${lastAssistantMsg}". Do NOT repeat that message or question. Advance the conversation forward by addressing the user's latest statement and guiding them to the next step.`;
      const retryResult = await generateReply({
        config,
        systemPrompt: retrySystemPrompt,
        messages,
      });

      if (retryResult.text && !retryResult.handoff) {
        const retryValidation = validateReplyOutput({
          draftText: retryResult.text,
          lastBotMessage: lastAssistantMsg,
          tenantProducts: tenantCatalogue,
          toolResults: actionPipelineResult?.calendarResult,
          knowledgeExcerpts: knowledge,
        });

        if (retryValidation.isValid) {
          effectiveText = retryResult.text;
          validation = retryValidation;
        }
      }
    }

    if (!validation.isValid) {
      console.warn('[ai auto-reply] validateReplyOutput rejected reply:', validation.reason);
      logDecision('AI_NO_RESPONSE', {
        conversationId,
        accountId,
        reason: 'validation_failed',
      });
      const update: Record<string, unknown> = {
        ai_autoreply_disabled: true,
        ai_handoff_summary: `AI output rejected by validation: ${validation.reason || 'Guardrail violation'}`,
      };
      if (config.handoffAgentId && !conv.assigned_agent_id) {
        update.assigned_agent_id = config.handoffAgentId;
      }
      await db.from('conversations').update(update).eq('id', conversationId);

      const fallbackMsg = config.fallback_message || DEFAULT_NEUTRAL_FALLBACK_MESSAGE;
      await engineSendText({
        accountId,
        userId: configOwnerUserId,
        conversationId,
        contactId,
        text: fallbackMsg,
        aiGenerated: true,
      });

      await markMessageReplied(db, conversationId, inboundMessageId);
      return;
    }

    // Atomically claim a reply slot
    const { data: claimed, error: claimErr } = await db.rpc(
      'claim_ai_reply_slot',
      {
        conversation_id: conversationId,
        max_replies: config.autoReplyMaxPerConversation,
      },
    );
    if (claimErr) {
      logDecision('AI_NO_RESPONSE', {
        conversationId,
        accountId,
        reason: 'claim_rpc_failed',
      });
      console.error('[ai auto-reply] claim_ai_reply_slot failed:', claimErr);
      return;
    }
    if (claimed !== true) {
      logDecision('AI_REPLY_LIMIT_REACHED', {
        conversationId,
        accountId,
        maxReplies: config.autoReplyMaxPerConversation,
        reason: 'claim_slot_exhausted',
      });
      await db
        .from('conversations')
        .update({
          ai_autoreply_disabled: true,
          ai_handoff_summary: `AI reply limit reached (${config.autoReplyMaxPerConversation} replies max).`,
        })
        .eq('id', conversationId);
      return;
    }

    await engineSendText({
      accountId,
      userId: configOwnerUserId,
      conversationId,
      contactId,
      text: sanitizeCustomerResponse(effectiveText),
      aiGenerated: true,
    });

    await markMessageReplied(db, conversationId, inboundMessageId);

    await persistConversationState(db, accountId, contactId, conversationId, {
      lastBotMessage: effectiveText,
    });

    logDecision('AI_RESPONDED', { conversationId, accountId });
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

async function markMessageReplied(
  db: ReturnType<typeof supabaseAdmin>,
  conversationId: string,
  inboundMessageId?: string,
): Promise<void> {
  if (!inboundMessageId) return;
  try {
    await db
      .from('messages')
      .update({ processing_status: 'replied', updated_at: new Date().toISOString() })
      .eq('conversation_id', conversationId)
      .eq('message_id', inboundMessageId);
  } catch (err) {
    console.warn('[ai auto-reply] markMessageReplied non-fatal error:', err);
  }
}
