import type { SupabaseClient } from '@supabase/supabase-js'
import { resolveTemplateRow, templateContentText } from '@/lib/whatsapp/template-body'

export interface SyncBroadcastParams {
  accountId: string
  contactId: string
  conversationId: string
  /**
   * If true, also advances any unreplied broadcast recipient rows for this
   * contact to 'replied' (e.g. when triggered by an inbound customer message).
   */
  markReplied?: boolean
}

/**
 * Ensures any broadcast messages sent to this contact are mirrored into
 * the `messages` table for their conversation thread.
 *
 * This powers two critical features:
 * 1. Team visibility: Agents opening the inbox can see the exact broadcast
 *    template (with personalized variables and delivery/read ticks) that
 *    prompted the customer's response.
 * 2. AI Auto-Reply: The AI context builder reads from `messages`. Having the
 *    broadcast template in `messages` allows the AI to know what was offered
 *    and reply accurately.
 */
export async function syncBroadcastMessagesToConversation(
  db: SupabaseClient,
  params: SyncBroadcastParams
): Promise<number> {
  const { accountId, contactId, conversationId, markReplied = false } = params

  try {
    // Find broadcasts sent to this contact in this account
    const { data: recs, error } = await db
      .from('broadcast_recipients')
      .select(`
        id,
        status,
        broadcast_id,
        whatsapp_message_id,
        sent_at,
        created_at,
        template_params,
        broadcasts!inner(account_id, template_name, template_language)
      `)
      .eq('contact_id', contactId)
      .eq('broadcasts.account_id', accountId)
      .in('status', ['sent', 'delivered', 'read', 'replied'])
      .order('created_at', { ascending: true })

    if (error || !recs || recs.length === 0) return 0

    let syncedCount = 0

    for (const row of recs) {
      if (!row.whatsapp_message_id) continue

      // If markReplied is requested and this was an unreplied broadcast, flip it to replied
      if (
        markReplied &&
        (row.status === 'sent' || row.status === 'delivered' || row.status === 'read')
      ) {
        await db
          .from('broadcast_recipients')
          .update({ status: 'replied', replied_at: new Date().toISOString() })
          .eq('id', row.id)
      }

      // Check if message already exists in conversation
      const { data: existing } = await db
        .from('messages')
        .select('id')
        .eq('conversation_id', conversationId)
        .eq('message_id', row.whatsapp_message_id)
        .maybeSingle()

      if (existing) continue

      const broadcast = row.broadcasts as unknown as {
        template_name?: string
        template_language?: string
      } | null
      const templateName = broadcast?.template_name
      const templateLanguage = broadcast?.template_language ?? 'en_US'

      let contentText: string | null = null
      if (templateName) {
        try {
          const resolved = await resolveTemplateRow(
            db,
            accountId,
            templateName,
            templateLanguage
          )
          const params = Array.isArray(row.template_params)
            ? (row.template_params as string[])
            : []
          contentText = templateContentText(resolved.row, params)
        } catch (tErr) {
          console.error('[broadcast-sync] Error resolving template:', tErr)
        }
      }

      const msgStatus =
        row.status === 'read'
          ? 'read'
          : row.status === 'delivered' || row.status === 'replied'
            ? 'delivered'
            : 'sent'

      const { error: insertErr } = await db.from('messages').insert({
        conversation_id: conversationId,
        sender_type: 'agent',
        content_type: 'template',
        content_text:
          contentText ||
          (templateName ? `[Template: ${templateName}]` : '[Broadcast Message]'),
        template_name: templateName ?? null,
        message_id: row.whatsapp_message_id,
        status: msgStatus,
        created_at: row.sent_at || row.created_at || new Date().toISOString(),
      })

      if (!insertErr) {
        syncedCount++
      } else {
        console.error('[broadcast-sync] Error inserting broadcast message:', insertErr)
      }
    }

    return syncedCount
  } catch (err) {
    console.error('[broadcast-sync] syncBroadcastMessagesToConversation failed:', err)
    return 0
  }
}
