import type { Conversation, Contact, Tag } from "@/types";

/**
 * Conversation select that embeds the contact plus its tags, so the Inbox
 * can filter conversations by contact tag without a second round-trip.
 * `contact_tags(tags(*))` returns the join rows; {@link normalizeConversation}
 * flattens them onto `contact.tags`.
 */
export const CONVERSATION_SELECT =
  "*, contact:contacts(*, contact_tags(tags(*)))";

/**
 * Inbox-specific select that also embeds the latest customer message timestamp,
 * allowing the Inbox to calculate active 24-hour WhatsApp messaging window status.
 */
export const INBOX_CONVERSATION_SELECT =
  "*, contact:contacts(*, contact_tags(tags(*))), messages(created_at)";

/** Raw shape returned by {@link CONVERSATION_SELECT} or {@link INBOX_CONVERSATION_SELECT} before flattening. */
type RawContact = Contact & { contact_tags?: { tags: Tag | null }[] };
type RawConversation = Omit<Conversation, "contact"> & {
  contact?: RawContact | null;
  messages?: { created_at: string }[];
};

/**
 * Flatten the embedded `contact_tags(tags(*))` join into `contact.tags`, and
 * derive `last_customer_message_at` from the embedded latest customer message if not already set.
 * Safe to call on rows fetched with {@link CONVERSATION_SELECT}; a row with
 * no contact (e.g. a freshly-inserted conversation) passes through untouched.
 */
export function normalizeConversation(raw: RawConversation): Conversation {
  const rawContact = raw.contact;
  const rawMessages = raw.messages;

  // Derive last_customer_message_at from the relation if not directly on the conversation row
  const lastCustomerMessageAt =
    raw.last_customer_message_at ??
    (rawMessages && rawMessages.length > 0 ? rawMessages[0].created_at : null);

  const base: Conversation = {
    ...(raw as unknown as Conversation),
    last_customer_message_at: lastCustomerMessageAt,
  };

  if (!rawContact) return base;

  const { contact_tags, ...contact } = rawContact;
  return {
    ...base,
    contact: {
      ...contact,
      tags: (contact_tags ?? [])
        .map((ct) => ct.tags)
        .filter((t): t is Tag => t != null),
    },
  };
}

export function normalizeConversations(
  rows: RawConversation[],
): Conversation[] {
  return rows.map(normalizeConversation);
}

/**
 * Check whether a conversation is currently within its 24-hour WhatsApp messaging window.
 * The 24-hour window starts when the customer sends an inbound message.
 */
export function isConversationWindowActive(conversation: Conversation): boolean {
  if (!conversation.last_customer_message_at) return false;
  const elapsedMs = Date.now() - new Date(conversation.last_customer_message_at).getTime();
  const maxWindowMs = 24 * 60 * 60 * 1000;
  return elapsedMs >= 0 && elapsedMs < maxWindowMs;
}

/**
 * Returns remaining time information for an active 24-hour window, or null if expired/no customer message.
 */
export function getConversationWindowRemaining(conversation: Conversation): {
  active: boolean;
  hoursLeft: number;
  label: string;
} | null {
  if (!conversation.last_customer_message_at) return null;
  const elapsedMs = Date.now() - new Date(conversation.last_customer_message_at).getTime();
  const maxWindowMs = 24 * 60 * 60 * 1000;
  if (elapsedMs < 0 || elapsedMs >= maxWindowMs) {
    return { active: false, hoursLeft: 0, label: "Expired" };
  }
  const hoursLeft = (maxWindowMs - elapsedMs) / (1000 * 60 * 60);
  const label =
    hoursLeft >= 1
      ? `${Math.floor(hoursLeft)}h left`
      : `${Math.floor(hoursLeft * 60)}m left`;
  return { active: true, hoursLeft, label };
}

export interface ContactFilters {
  /** Tag ids; a conversation matches if its contact has ANY of them (OR). */
  tagIds: string[];
  /** Exact company match, or null for no company filter. */
  company: string | null;
}

/**
 * Whether a conversation passes the contact-based Inbox filters (issue #272).
 * Empty `tagIds` and null `company` are no-ops, so the default (no filters)
 * always matches. Tags use OR logic, consistent with Broadcast audiences.
 */
export function matchesContactFilters(
  conversation: Conversation,
  { tagIds, company }: ContactFilters,
): boolean {
  if (tagIds.length > 0) {
    const contactTagIds = conversation.contact?.tags ?? [];
    if (!contactTagIds.some((t) => tagIds.includes(t.id))) return false;
  }

  if (company !== null && conversation.contact?.company?.trim() !== company) {
    return false;
  }

  return true;
}
