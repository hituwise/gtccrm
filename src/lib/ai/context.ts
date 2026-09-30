import type { SupabaseClient } from '@supabase/supabase-js'
import type { ChatMessage } from './types'
import { aiContextMessageLimit } from './defaults'

interface DbMessage {
  sender_type: 'customer' | 'agent' | 'bot'
  content_text: string | null
  content_type?: string | null
  interactive_reply_id?: string | null
  template_name?: string | null
}

/**
 * Fetch the last N text, interactive, and template messages of a conversation and map them to the
 * provider-neutral chat shape. Customer messages become `user`; agent
 * and bot messages become `assistant`. Interactive replies include the button/option
 * label and payload so AI has full context of lead interactions. Template messages include
 * the template name and rendered text so AI understands broadcast offers.
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
    .select('sender_type, content_text, content_type, interactive_reply_id, template_name')
    .eq('conversation_id', conversationId)
    .in('content_type', ['text', 'interactive', 'template'])
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
      } else if (m.content_type === 'template' && m.template_name) {
        content = `[Template: ${m.template_name}]\n${content}`
      }
      return {
        role: m.sender_type === 'customer' ? 'user' : 'assistant',
        content,
      }
    })
}
