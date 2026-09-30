import { NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { syncBroadcastMessagesToConversation } from '@/lib/whatsapp/broadcast-inbox-sync'

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { supabase, accountId } = await requireRole('viewer')
    const { id: conversationId } = await params

    // Fetch conversation to get contact_id and verify it belongs to this account
    const { data: conv, error: convErr } = await supabase
      .from('conversations')
      .select('id, contact_id')
      .eq('id', conversationId)
      .eq('account_id', accountId)
      .single()

    if (convErr || !conv) {
      return NextResponse.json(
        { error: 'Conversation not found' },
        { status: 404 }
      )
    }

    const synced = await syncBroadcastMessagesToConversation(supabase, {
      accountId,
      contactId: conv.contact_id,
      conversationId: conv.id,
      markReplied: false,
    })

    return NextResponse.json({ success: true, synced })
  } catch (err) {
    return toErrorResponse(err)
  }
}
