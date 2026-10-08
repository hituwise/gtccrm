import type { SupabaseClient } from '@supabase/supabase-js';
import { logAiAction } from './action-logger';
import { applyContactTag } from './tag-service';
import type { ProductKey } from './types';

export interface MilestoneNoteArgs {
  db: SupabaseClient;
  accountId: string;
  contactId: string;
  conversationId?: string | null;
  userId?: string | null;
  productName: string;
  customerType: string;
  mainRequirement: string;
  importantInfo?: string;
  bookingStatus?: string;
  nextAction?: string;
}

/**
 * Creates a structured internal CRM note at a meaningful milestone.
 * INTERNAL ONLY — never transmitted over WhatsApp.
 */
export async function createInternalCrmNote(args: MilestoneNoteArgs): Promise<string> {
  const {
    db,
    accountId,
    contactId,
    conversationId,
    userId = null,
    productName,
    customerType,
    mainRequirement,
    importantInfo,
    bookingStatus = 'In discussion',
    nextAction = 'Follow up with customer',
  } = args;

  const parts = [
    `• Product: ${productName}`,
    `• Customer Type: ${customerType}`,
    `• Main Requirement: ${mainRequirement}`,
  ];

  if (importantInfo) {
    parts.push(`• Details: ${importantInfo}`);
  }
  parts.push(`• Booking Status: ${bookingStatus}`);
  parts.push(`• Next Action: ${nextAction}`);

  const noteText = parts.join('\n');

  try {
    const { data: note, error } = await db
      .from('contact_notes')
      .insert({
        account_id: accountId,
        contact_id: contactId,
        user_id: userId,
        note_text: noteText,
        author_type: 'ai_agent',
      })
      .select('id')
      .maybeSingle();

    if (error) {
      console.warn('[crm-service] Failed to create contact note:', error.message);
    } else {
      await logAiAction({
        db,
        accountId,
        contactId,
        conversationId,
        action: 'NOTE_CREATED',
        details: { noteId: note?.id, noteText },
      });
    }
  } catch (err) {
    console.warn('[crm-service] Unexpected error inserting note:', err);
  }

  return noteText;
}

export interface AssignLeadArgs {
  db: SupabaseClient;
  accountId: string;
  conversationId: string;
  contactId: string;
  productKey: ProductKey;
  targetAgentId?: string | null;
  candidateAgentIds?: string[];
  teamName?: string;
}

/**
 * Assigns a conversation/lead to a configured agent or round-robin among team members.
 * If no team or agent is configured, leaves unassigned and applies FOLLOW_UP_REQUIRED.
 */
export async function assignLeadToTeam(args: AssignLeadArgs): Promise<string | null> {
  const {
    db,
    accountId,
    conversationId,
    contactId,
    productKey,
    targetAgentId,
    candidateAgentIds = [],
    teamName,
  } = args;

  let assignedId: string | null = targetAgentId || null;

  // If candidate agents exist (team pool), select round-robin / lowest-load agent
  if (!assignedId && candidateAgentIds.length > 0) {
    if (candidateAgentIds.length === 1) {
      assignedId = candidateAgentIds[0];
    } else {
      // Pick agent with fewest currently assigned conversations
      const { data: counts } = await db
        .from('conversations')
        .select('assigned_agent_id')
        .eq('account_id', accountId)
        .in('assigned_agent_id', candidateAgentIds);

      const freq: Record<string, number> = {};
      candidateAgentIds.forEach((id) => (freq[id] = 0));
      (counts || []).forEach((row) => {
        if (row.assigned_agent_id && freq[row.assigned_agent_id] !== undefined) {
          freq[row.assigned_agent_id]++;
        }
      });

      // Find minimum
      assignedId = candidateAgentIds.reduce((best, curr) =>
        freq[curr] < freq[best] ? curr : best,
      );
    }
  }

  if (assignedId) {
    // Verify membership in account
    const { data: profile } = await db
      .from('profiles')
      .select('id, full_name')
      .eq('account_id', accountId)
      .eq('user_id', assignedId)
      .maybeSingle();

    if (profile) {
      await db
        .from('conversations')
        .update({ assigned_agent_id: assignedId, updated_at: new Date().toISOString() })
        .eq('id', conversationId)
        .eq('account_id', accountId);

      await logAiAction({
        db,
        accountId,
        contactId,
        conversationId,
        action: 'LEAD_ASSIGNED',
        details: {
          productKey,
          teamName: teamName || 'Default Team',
          assignedAgentId: assignedId,
          agentName: profile.full_name,
        },
      });

      return assignedId;
    }
  }

  // If no configured team or member exists, DO NOT assign randomly.
  // Flag for follow-up / human queue.
  await applyContactTag({
    db,
    accountId,
    contactId,
    conversationId,
    tagName: 'FOLLOW_UP_REQUIRED',
    color: '#F97316',
  });

  return null;
}
