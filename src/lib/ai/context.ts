import type { SupabaseClient } from '@supabase/supabase-js'
import type { ChatMessage } from './types'
import { aiContextMessageLimit } from './defaults'

interface DbMessage {
  sender_type: 'customer' | 'agent' | 'bot'
  content_text: string | null
  content_type?: string | null
  interactive_reply_id?: string | null
}

/**
 * Fetch the last N text and interactive messages of a conversation and map them to the
 * provider-neutral chat shape. Customer messages become `user`; agent
 * and bot messages become `assistant`. Interactive replies include the button/option
 * label and payload so AI has full context of lead interactions.
 *
 * Ordered oldest-first (chronological) so the transcript reads
 * naturally and the most recent customer message lands last.
 */
export async function buildConversationContext(
  db: SupabaseClient,
  conversationId: string,
  limit: number = aiContextMessageLimit(),
): Promise<ChatMessage[]> {
  const { data, error } = await db
    .from('messages')
    .select('sender_type, content_text, content_type, interactive_reply_id')
    .eq('conversation_id', conversationId)
    .in('content_type', ['text', 'interactive'])
    .order('created_at', { ascending: false })
    .limit(limit)

  if (error) throw error

  const rows = ((data ?? []) as DbMessage[]).reverse()
  return rows
    .filter((m) => m.content_text && m.content_text.trim())
    .map((m) => {
      let content = m.content_text!.trim()
      if (
        m.content_type === 'interactive' &&
        m.interactive_reply_id &&
        m.interactive_reply_id !== content
      ) {
        content = `${content} (${m.interactive_reply_id})`
      }
      return {
        role: m.sender_type === 'customer' ? 'user' : 'assistant',
        content,
      }
    })
}
