import { describe, it, expect, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { syncBroadcastMessagesToConversation } from './broadcast-inbox-sync'

vi.mock('@/lib/whatsapp/template-body', () => ({
  resolveTemplateRow: vi.fn(async () => ({
    row: { id: 't1', body_text: 'Hello {{1}}, welcome to {{2}}!' },
    language: 'en_US',
    malformed: false,
  })),
  templateContentText: vi.fn((row, params) => {
    return `Hello ${params[0] || 'Friend'}, welcome to ${params[1] || 'Course'}!`
  }),
}))

describe('syncBroadcastMessagesToConversation', () => {
  it('inserts broadcast message into messages when missing', async () => {
    const insertedMessages: Record<string, unknown>[] = []
    const updatedRecipients: Record<string, unknown>[] = []

    const updatedConversations: Record<string, unknown>[] = []

    const fakeDb = {
      from: (table: string) => {
        if (table === 'conversations') {
          return {
            update: (patch: Record<string, unknown>) => {
              updatedConversations.push(patch)
              return {
                eq: () => Promise.resolve({ error: null }),
              }
            },
          }
        }
        if (table === 'broadcast_recipients') {
          return {
            select: () => ({
              eq: () => ({
                eq: () => ({
                  in: () => ({
                    order: () =>
                      Promise.resolve({
                        data: [
                          {
                            id: 'rec-1',
                            status: 'read',
                            broadcast_id: 'b-1',
                            whatsapp_message_id: 'wamid.B1',
                            sent_at: '2026-09-29T10:00:00Z',
                            template_params: ['Ritibrataa', 'Junior Training'],
                            broadcasts: {
                              account_id: 'acc-1',
                              template_name: 'jr_training',
                              template_language: 'en_US',
                            },
                          },
                        ],
                        error: null,
                      }),
                  }),
                }),
              }),
            }),
            update: (patch: Record<string, unknown>) => {
              updatedRecipients.push(patch)
              return {
                eq: () => Promise.resolve({ error: null }),
              }
            },
          }
        }
        if (table === 'messages') {
          return {
            select: () => ({
              eq: () => ({
                eq: () => ({
                  maybeSingle: () => Promise.resolve({ data: null, error: null }),
                }),
              }),
            }),
            insert: (row: Record<string, unknown>) => {
              insertedMessages.push(row)
              return Promise.resolve({ error: null })
            },
          }
        }
        return {}
      },
    } as unknown as SupabaseClient

    const count = await syncBroadcastMessagesToConversation(fakeDb, {
      accountId: 'acc-1',
      contactId: 'c-1',
      conversationId: 'conv-1',
      markReplied: true,
    })

    expect(count).toBe(1)
    expect(insertedMessages).toHaveLength(1)
    expect(insertedMessages[0]).toMatchObject({
      conversation_id: 'conv-1',
      sender_type: 'agent',
      content_type: 'template',
      template_name: 'jr_training',
      message_id: 'wamid.B1',
      status: 'read',
      content_text: 'Hello Ritibrataa, welcome to Junior Training!',
      created_at: '2026-09-29T10:00:00Z',
    })
    expect(updatedRecipients).toHaveLength(1)
    expect(updatedRecipients[0].status).toBe('replied')
    expect(updatedConversations).toHaveLength(1)
    expect(updatedConversations[0]).toMatchObject({
      last_message_at: '2026-09-29T10:00:00Z',
      last_message_text: 'Hello Ritibrataa, welcome to Junior Training!',
    })
  })

  it('skips insertion if message already exists in messages table', async () => {
    const insertedMessages: Record<string, unknown>[] = []

    const fakeDb = {
      from: (table: string) => {
        if (table === 'broadcast_recipients') {
          return {
            select: () => ({
              eq: () => ({
                eq: () => ({
                  in: () => ({
                    order: () =>
                      Promise.resolve({
                        data: [
                          {
                            id: 'rec-1',
                            status: 'replied',
                            broadcast_id: 'b-1',
                            whatsapp_message_id: 'wamid.B1',
                            sent_at: '2026-09-29T10:00:00Z',
                            template_params: ['Ritibrataa'],
                            broadcasts: {
                              account_id: 'acc-1',
                              template_name: 'jr_training',
                            },
                          },
                        ],
                        error: null,
                      }),
                  }),
                }),
              }),
            }),
          }
        }
        if (table === 'messages') {
          return {
            select: () => ({
              eq: () => ({
                eq: () => ({
                  maybeSingle: () =>
                    Promise.resolve({ data: { id: 'm-existing' }, error: null }),
                }),
              }),
            }),
            insert: (row: Record<string, unknown>) => {
              insertedMessages.push(row)
              return Promise.resolve({ error: null })
            },
          }
        }
        return {}
      },
    } as unknown as SupabaseClient

    const count = await syncBroadcastMessagesToConversation(fakeDb, {
      accountId: 'acc-1',
      contactId: 'c-1',
      conversationId: 'conv-1',
    })

    expect(count).toBe(0)
    expect(insertedMessages).toHaveLength(0)
  })
})
