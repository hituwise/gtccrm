import type { SupabaseClient } from '@supabase/supabase-js';
import { addContactTagAndDispatch } from '@/lib/contacts/tag-events';
import { removeContactTag } from '@/lib/contacts/tag-write';
import { logAiAction } from './action-logger';
import {
  type ProductTagName,
  type StageTagName,
  type TemperatureTagName,
  type LeadTemperature,
  APPROVED_TEMPERATURE_TAGS,
} from './types';

/**
 * Finds or creates a tag by exact name within the account scope.
 */
export async function getOrCreateAccountTag(
  db: SupabaseClient,
  accountId: string,
  tagName: string,
  color: string = '#4F46E5',
): Promise<string | null> {
  // 1. Try to find existing tag (case-insensitive name match)
  const { data: existing, error: findErr } = await db
    .from('tags')
    .select('id')
    .eq('account_id', accountId)
    .ilike('name', tagName)
    .maybeSingle();

  if (findErr) {
    console.warn('[tag-service] Error finding tag:', findErr.message);
  }

  if (existing?.id) {
    return existing.id;
  }

  // 2. Insert new tag scoped to this tenant
  const { data: created, error: createErr } = await db
    .from('tags')
    .insert({
      account_id: accountId,
      name: tagName,
      color,
    })
    .select('id')
    .maybeSingle();

  if (createErr) {
    console.warn('[tag-service] Error creating tag:', createErr.message);
    return null;
  }

  return created?.id ?? null;
}

/**
 * Safely attaches an approved tag to a contact, invoking CRM automations and audit logging.
 */
export async function applyContactTag(args: {
  db: SupabaseClient;
  accountId: string;
  contactId: string;
  conversationId?: string | null;
  tagName: ProductTagName | StageTagName | TemperatureTagName;
  color?: string;
}): Promise<boolean> {
  const { db, accountId, contactId, conversationId, tagName, color } = args;

  try {
    const tagId = await getOrCreateAccountTag(db, accountId, tagName, color);
    if (!tagId) return false;

    const res = await addContactTagAndDispatch({
      db,
      accountId,
      contactId,
      tagId,
    });

    if (res.added) {
      await logAiAction({
        db,
        accountId,
        contactId,
        conversationId,
        action: 'TAG_ADDED',
        details: { tagName, tagId },
      });
    }

    return res.added;
  } catch (err) {
    console.warn(`[tag-service] Failed to apply tag ${tagName}:`, err);
    return false;
  }
}

/**
 * Removes a tag by name from a contact if present.
 */
export async function detachContactTag(args: {
  db: SupabaseClient;
  accountId: string;
  contactId: string;
  conversationId?: string | null;
  tagName: string;
}): Promise<boolean> {
  const { db, accountId, contactId, conversationId, tagName } = args;

  try {
    const { data: tag } = await db
      .from('tags')
      .select('id')
      .eq('account_id', accountId)
      .ilike('name', tagName)
      .maybeSingle();

    if (!tag?.id) return false;

    await removeContactTag(db, {
      accountId,
      contactId,
      tagId: tag.id,
    });

    await logAiAction({
      db,
      accountId,
      contactId,
      conversationId,
      action: 'TAG_REMOVED',
      details: { tagName, tagId: tag.id },
    });

    return true;
  } catch (err) {
    console.warn(`[tag-service] Failed to detach tag ${tagName}:`, err);
    return false;
  }
}

/**
 * Updates lead temperature on the contact record and keeps temperature tags
 * (HOT_LEAD, WARM_LEAD, COLD_LEAD) mutually exclusive.
 */
export async function updateLeadTemperature(args: {
  db: SupabaseClient;
  accountId: string;
  contactId: string;
  conversationId?: string | null;
  temperature: LeadTemperature;
}): Promise<void> {
  const { db, accountId, contactId, conversationId, temperature } = args;

  const targetTagName = APPROVED_TEMPERATURE_TAGS[temperature];
  const tagsToRemove = Object.values(APPROVED_TEMPERATURE_TAGS).filter(
    (t) => t !== targetTagName,
  );

  // 1. Remove opposing temperature tags
  for (const t of tagsToRemove) {
    await detachContactTag({
      db,
      accountId,
      contactId,
      conversationId,
      tagName: t,
    });
  }

  // 2. Add current temperature tag with distinctive colors
  const color =
    temperature === 'hot'
      ? '#EF4444' // red
      : temperature === 'warm'
      ? '#F59E0B' // amber
      : '#6B7280'; // gray

  await applyContactTag({
    db,
    accountId,
    contactId,
    conversationId,
    tagName: targetTagName,
    color,
  });

  // 3. Update structured field on contacts
  await db
    .from('contacts')
    .update({
      lead_temperature: temperature,
      updated_at: new Date().toISOString(),
    })
    .eq('id', contactId)
    .eq('account_id', accountId);

  await logAiAction({
    db,
    accountId,
    contactId,
    conversationId,
    action: 'LEAD_TEMPERATURE_CHANGED',
    details: { temperature, tag: targetTagName },
  });
}
