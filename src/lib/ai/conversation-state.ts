import type { SupabaseClient } from '@supabase/supabase-js';
import type { TenantProductConfig, TenantBusinessProfile } from '@/lib/ai/actions/types';
import { extractEmailFromText } from '@/lib/calendar/booking-coordinator';
import { hasDateSpecified, hasTimeSpecified } from '@/lib/calendar/date-parser';

export interface CollectedCustomerFields {
  customerName?: string | null;
  email?: string | null;
  phone?: string | null;
  childAge?: number | null;
  preferredTimeText?: string | null;
  hasDate: boolean;
  hasTime: boolean;
  selectedProductId?: string | null;
  lastQuestionAsked?: string | null;
}

const SCHEDULE_KEYWORDS = [
  'class timing',
  'class timings',
  'batch timing',
  'batch timings',
  'schedule',
  'what time are the classes',
  'what time is the class',
  'when are the classes',
  'when is the class',
  'timing of class',
  'timings of class',
  'what are the timings',
  'available timings',
  'batch details',
  'working hours',
];

/**
 * Detects whether the customer is asking about class/service timings or schedules.
 */
export function detectScheduleQuery(text: string): boolean {
  const lower = text.toLowerCase().trim();
  return SCHEDULE_KEYWORDS.some((kw) => lower.includes(kw));
}

/**
 * Formats a factual, tenant-grounded response for schedule and timing queries.
 * If the tenant has configured working hours / availability days, it outputs them.
 * If not configured, it politely informs the customer that the team will confirm
 * the upcoming batch timings, rather than hallucinating or inventing times.
 */
export function formatScheduleResponse(
  product?: TenantProductConfig,
  profile?: TenantBusinessProfile,
): string {
  if (product && (product.workingHoursStart || product.availabilityDays?.length)) {
    const days = product.availabilityDays?.length
      ? product.availabilityDays.join(', ')
      : 'Monday to Saturday';
    const hours = product.workingHoursStart && product.workingHoursEnd
      ? `${product.workingHoursStart} to ${product.workingHoursEnd} (${product.timezone || profile?.timezone || 'IST'})`
      : 'flexible batch slots throughout the week';

    return (
      `Here are the schedule details for ${product.name}:\n\n` +
      `📅 Available Days: ${days}\n` +
      `⏰ Timings: ${hours}\n\n` +
      `Would you like to book a slot during these hours?`
    );
  }

  // Missing or unconfigured schedule: DO NOT INVENT TIMINGS!
  const serviceName = product?.name || 'our classes';
  return (
    `Thank you for asking about the schedule for ${serviceName}. ` +
    `Our team will confirm the upcoming batch timings and available slots with you shortly! ` +
    `What day or time works best for your schedule in the meantime?`
  );
}

/**
 * Extracts collected fields and conversation state by inspecting the conversation history.
 */
export function extractConversationCollectedFields(
  messages: Array<{ role: string; content: string }>,
  contactRecord?: { name?: string | null; email?: string | null; phone?: string | null },
): CollectedCustomerFields {
  let email: string | null = contactRecord?.email || null;
  let customerName: string | null = contactRecord?.name || null;
  let childAge: number | null = null;
  let preferredTimeText: string | null = null;
  let hasDate = false;
  let hasTime = false;
  let lastQuestionAsked: string | null = null;

  // Scan user messages backwards to find the most recent preferred time and details
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    const text = msg.content;

    if (msg.role === 'user') {
      // Email extraction
      if (!email) {
        const foundEmail = extractEmailFromText(text);
        if (foundEmail) email = foundEmail;
      }

      // Age extraction (e.g. "6 years old", "age 8")
      if (!childAge) {
        const ageMatch = text.match(/(?:my\s+(?:son|daughter|child|kid)\s+is\s+)?(\d{1,2})\s*(?:years?\s*old|yo|yr|yrs)/i) ||
          text.match(/(?:age\s*:?\s*)(\d{1,2})/i);
        if (ageMatch) {
          const parsed = parseInt(ageMatch[1], 10);
          if (parsed >= 3 && parsed <= 18) childAge = parsed;
        }
      }

      // Date & Time extraction
      const msgHasDate = hasDateSpecified(text);
      const msgHasTime = hasTimeSpecified(text);

      if ((msgHasDate || msgHasTime) && !preferredTimeText) {
        preferredTimeText = text;
        if (msgHasDate) hasDate = true;
        if (msgHasTime) hasTime = true;
      }
    } else if (msg.role === 'assistant' && !lastQuestionAsked) {
      // Determine what the assistant previously asked
      const lower = text.toLowerCase();
      if (lower.includes('email') || lower.includes('calendar invite') || lower.includes('best email')) {
        lastQuestionAsked = 'ASKED_EMAIL';
      } else if (lower.includes('what day and time') || lower.includes('which day') || lower.includes('what time')) {
        lastQuestionAsked = 'ASKED_DATE_TIME';
      } else if (lower.includes('what name') || lower.includes('your name')) {
        lastQuestionAsked = 'ASKED_NAME';
      } else if (lower.includes('which one would you like') || lower.includes('we offer both')) {
        lastQuestionAsked = 'ASKED_SERVICE_SELECTION';
      }
    }
  }

  // Filter placeholder contact names like "Customer", "Parent", "User"
  if (customerName && /^(?:parent|customer|there|test|lead|user)$/i.test(customerName.trim())) {
    customerName = null;
  }

  return {
    customerName,
    email,
    phone: contactRecord?.phone || null,
    childAge,
    preferredTimeText,
    hasDate,
    hasTime,
    lastQuestionAsked,
  };
}

/**
 * Checks if the assistant is about to ask the exact same question that was just asked.
 */
export function isDuplicateQuestion(
  lastQuestionAsked: string | null | undefined,
  proposedQuestionType: 'EMAIL' | 'DATE_TIME' | 'NAME' | 'SERVICE',
): boolean {
  if (!lastQuestionAsked) return false;
  if (lastQuestionAsked === 'ASKED_EMAIL' && proposedQuestionType === 'EMAIL') return true;
  if (lastQuestionAsked === 'ASKED_DATE_TIME' && proposedQuestionType === 'DATE_TIME') return true;
  if (lastQuestionAsked === 'ASKED_NAME' && proposedQuestionType === 'NAME') return true;
  return false;
}

/**
 * Idempotently syncs discovered customer fields (e.g. email, real name) to the CRM contact record.
 */
export async function syncDiscoveredContactFields(
  db: SupabaseClient,
  accountId: string,
  contactId: string,
  fields: { name?: string | null; email?: string | null },
): Promise<void> {
  const updates: Record<string, string> = {};
  if (fields.name && !/^(?:parent|customer|there|test|lead|user)$/i.test(fields.name.trim())) {
    updates.name = fields.name.trim();
  }
  if (fields.email && fields.email.includes('@')) {
    updates.email = fields.email.trim().toLowerCase();
  }

  if (Object.keys(updates).length > 0) {
    updates.updated_at = new Date().toISOString();
    try {
      await db
        .from('contacts')
        .update(updates)
        .eq('id', contactId)
        .eq('account_id', accountId);
    } catch (err) {
      console.warn('[conversation-state] syncDiscoveredContactFields non-fatal error:', err);
    }
  }
}
