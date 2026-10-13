import type { SupabaseClient } from '@supabase/supabase-js';
import type { TenantProductConfig, TenantBusinessProfile } from '@/lib/ai/actions/types';
import { extractEmailFromText } from '@/lib/calendar/booking-coordinator';
import { hasDateSpecified, hasTimeSpecified } from '@/lib/calendar/date-parser';
import { logAiAction } from '@/lib/ai/actions/action-logger';

export type ConversationBookingState =
  | 'INITIAL'
  | 'OFFERED_CALL_OR_DEMO'
  | 'AWAITING_PREFERRED_SLOT'
  | 'AWAITING_CUSTOMER_DETAILS'
  | 'AWAITING_EMAIL'
  | 'BOOKED'
  | 'HANDOFF';

export interface PersistedConversationState {
  state: ConversationBookingState;
  productKey?: string | null;
  productServiceId?: string | null;
  selectedProducts?: string[];
  appointmentType?: string | null;
  preferredDateText?: string | null;
  preferredTimeText?: string | null;
  parsedStartTime?: string | null;
  customerName?: string | null;
  email?: string | null;
  timezone?: string | null;
  offeredSlots?: Array<{ startTime: string; endTime: string; humanText: string }>;
  lastBotMessage?: string | null;
  lastQuestionAsked?: string | null;
  updatedAt?: string;
}

export interface CollectedCustomerFields {
  customerName?: string | null;
  parentName?: string | null;
  childName?: string | null;
  explicitNameProvided?: boolean;
  email?: string | null;
  noEmailExplicitlyStated?: boolean;
  phone?: string | null;
  childAge?: number | null;
  isChildCourse?: boolean;
  preferredTimeText?: string | null;
  hasDate: boolean;
  hasTime: boolean;
  selectedProductId?: string | null;
  lastQuestionAsked?: string | null;
  conversationState?: ConversationBookingState;
  assistantOfferedCall?: boolean;
  customerAcceptedCall?: boolean;
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

import { type DetectedLanguage } from './defaults';

/**
 * Formats a factual, tenant-grounded response for schedule and timing queries.
 * If the tenant has configured working hours / availability days or a custom template,
 * it formats according to the tenant's specifications in the customer's language.
 * If not configured, it politely informs the customer that the team will confirm
 * the upcoming batch timings, rather than hallucinating or inventing times.
 */
export function formatScheduleResponse(
  product?: TenantProductConfig,
  profile?: TenantBusinessProfile,
  language: DetectedLanguage = 'en',
): string {
  if (product?.scheduleMessageTemplate && product.scheduleMessageTemplate.trim()) {
    return product.scheduleMessageTemplate.trim();
  }

  if (product && (product.workingHoursStart || product.availabilityDays?.length)) {
    const days = product.availabilityDays?.length
      ? product.availabilityDays.join(', ')
      : 'Monday to Saturday';
    const hours =
      product.workingHoursStart && product.workingHoursEnd
        ? `${product.workingHoursStart} to ${product.workingHoursEnd} (${product.timezone || profile?.timezone || 'IST'})`
        : 'flexible batch slots throughout the week';

    if (language === 'gu') {
      return (
        `${product.name} માટે સમયપત્રક વિગતો અહીં છે:\n\n` +
        `📅 દિવસો: ${days}\n` +
        `⏰ સમય: ${hours}\n\n` +
        `શું તમે આ કલાકો દરમિયાન સ્લોટ બુક કરવા માંગો છો?`
      );
    }
    if (language === 'hi' || language === 'hinglish') {
      return (
        `${product.name} के लिए शेड्यूल विवरण यहाँ हैं:\n\n` +
        `📅 दिन: ${days}\n` +
        `⏰ समय: ${hours}\n\n` +
        `क्या आप इस समय के दौरान एक स्लॉट बुक करना चाहेंगे?`
      );
    }

    return (
      `Here are the schedule details for ${product.name}:\n\n` +
      `📅 Available Days: ${days}\n` +
      `⏰ Timings: ${hours}\n\n` +
      `Would you like to book a slot during these hours?`
    );
  }

  // Missing or unconfigured schedule: DO NOT INVENT TIMINGS!
  const serviceName = product?.name || 'our classes';
  if (language === 'gu') {
    return (
      `${serviceName} ના સમયપત્રક વિશે પૂછવા બદલ આભાર. ` +
      `અમારી ટીમ આગામી બેચના સમય અને ઉપલબ્ધ સ્લોટની પુષ્ટિ ટૂંક સમયમાં કરશે! ` +
      `તમારા માટે કયો દિવસ અથવા સમય સૌથી અનુકૂળ રહેશે?`
    );
  }
  if (language === 'hi' || language === 'hinglish') {
    return (
      `${serviceName} के शेड्यूल के बारे में पूछने के लिए धन्यवाद। ` +
      `हमारी टीम आगामी बैच के समय की पुष्टि आपसे जल्द ही करेगी! ` +
      `आपके लिए कौन सा दिन या समय सबसे अच्छा रहेगा?`
    );
  }

  return (
    `Thank you for asking about the schedule for ${serviceName}. ` +
    `Our team will confirm the upcoming batch timings and available slots with you shortly! ` +
    `What day or time works best for your schedule in the meantime?`
  );
}

/**
 * Detects whether the customer is giving an affirmative response.
 * Handles standalone affirmatives ("yes", "sure", "okay") and contextual affirmatives
 * ("yes please", "yes when can we schedule", "when can we schedule", "let's book a call").
 */
export function isAffirmativeReply(text: string): boolean {
  const clean = text.toLowerCase().trim().replace(/[.,!?;:]+$/, '').trim();
  // Standalone affirmatives
  if (/^(?:yes|yes please|yes pls|yeah|yep|yup|sure|sure thing|sure please|okay|ok|okay please|ok please|definitely|absolutely|sounds good|let's do it|lets do it|go ahead|proceed|of course)$/i.test(clean)) {
    return true;
  }
  // Yes / sure / ok followed by schedule / book / call / when
  if (/^(?:yes|sure|okay|ok)\b.*(?:schedule|book|call|slot|time|when)/i.test(clean)) {
    return true;
  }
  // "when can we schedule", "when can we connect", "when is it possible to schedule", "when can we book"
  if (/^(?:when can we|when can i|how can we|how can i|when is it possible to|when do we)\s*(?:schedule|book|connect|talk|meet|have a call)/i.test(clean)) {
    return true;
  }
  // "let's book a call", "lets schedule a call", "let's schedule", etc.
  if (/\b(?:let'?s|lets|want to|would like to|ready to|can we)\s+(?:book|schedule|have a call|set up a call|proceed with (?:a |the )?call)\b/i.test(clean)) {
    return true;
  }
  if (/^(?:schedule it|book it|yes book|yes schedule|book a call|schedule a call)$/i.test(clean)) {
    return true;
  }
  return false;
}

/**
 * Checks whether an assistant message was offering a call, demo, or appointment.
 */
export function didAssistantOfferCallOrDemo(text: string): boolean {
  const lower = text.toLowerCase();
  return (
    lower.includes('schedule a quick call') ||
    lower.includes('schedule a call') ||
    lower.includes('book a call') ||
    lower.includes('book a quick demo') ||
    lower.includes('book a demo') ||
    lower.includes('book a free') ||
    lower.includes('would you like to schedule') ||
    lower.includes('would you like to book') ||
    lower.includes('would you like to see a quick demo') ||
    lower.includes('training advisor') ||
    lower.includes('business growth call') ||
    lower.includes('discovery call') ||
    lower.includes('introductory call') ||
    /would you like.*(?:call|demo|session)/i.test(lower) ||
    /schedule a \d+-minute/i.test(lower) ||
    /book a \d+-minute/i.test(lower)
  );
}

/**
 * Checks whether an assistant message was asking for preferred day or time.
 */
export function didAssistantAskForSlot(text: string): boolean {
  const lower = text.toLowerCase();
  return (
    lower.includes('what day and time') ||
    lower.includes('which day') ||
    lower.includes('what time') ||
    lower.includes('preferred day') ||
    lower.includes('convenient time') ||
    lower.includes('what date') ||
    lower.includes('what day or time')
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
  let customerName: string | null = null;
  let parentName: string | null = null;
  let childName: string | null = null;
  let explicitNameProvided = false;
  let noEmailExplicitlyStated = false;
  let childAge: number | null = null;
  let isChildCourse = false;
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

      // Check if user explicitly stated they do not have an email
      if (/(?:no\s+email|without\s+email|don'?t\s+have\s+(?:an?\s+)?email|do\s+not\s+have\s+(?:an?\s+)?email|skip\s+email|not\s+having\s+email)/i.test(text)) {
        noEmailExplicitlyStated = true;
      }

      // Age extraction (e.g. "6 years old", "age 8", "9 year son")
      if (!childAge) {
        const ageMatch =
          text.match(/(?:my\s+(?:son|daughter|child|kid)\s+is\s+)?(\d{1,2})\s*(?:years?\s*old|yo|yr|yrs)/i) ||
          text.match(/(?:(?:son|daughter|child|kid)\s+is\s+)(\d{1,2})/i) ||
          text.match(/(\d{1,2})\s*year(?:\s*old)?\s*(?:son|daughter|child|kid)/i) ||
          text.match(/(?:age\s*:?\s*)(\d{1,2})/i);
        if (ageMatch) {
          const parsed = parseInt(ageMatch[1], 10);
          if (parsed >= 3 && parsed <= 18) {
            childAge = parsed;
            isChildCourse = true;
          }
        }
      }

      // Check for child course markers
      if (/(?:son|daughter|child|kid|children|abacus\s*kids|rubik)/i.test(text)) {
        isChildCourse = true;
      }

      // Child Name Extraction
      if (!childName) {
        const childMatch =
          text.match(/(?:child(?:'s)?|son(?:'s)?|daughter(?:'s)?|kid(?:'s)?)\s*(?:name)?\s*(?:is|:)\s*([A-Za-z]{2,20}(?:\s+[A-Za-z]{2,20})?)/i) ||
          text.match(/(?:child|son|daughter):\s*([A-Za-z]{2,20}(?:\s+[A-Za-z]{2,20})?)/i) ||
          text.match(/(?:his|her)\s+name\s+is\s+([A-Za-z]{2,20}(?:\s+[A-Za-z]{2,20})?)/i) ||
          text.match(/(?:for\s+my\s+(?:son|daughter|child)\s+)([A-Za-z]{2,20})/i);

        if (childMatch && !/^(?:demo|class|abacus|rubik|online|offline|morning|evening|tomorrow|today)$/i.test(childMatch[1].trim())) {
          childName = childMatch[1].trim();
        }
      }

      // Parent Name / Customer Name Extraction
      if (!parentName && !explicitNameProvided) {
        const parentMatch =
          text.match(/(?:(?:parent(?:'s)?|my|father|mother)\s+)?name\s*(?:is|:)\s*([A-Za-z]{2,20}(?:\s+[A-Za-z]{2,20})?)/i) ||
          text.match(/(?:parent):\s*([A-Za-z]{2,20}(?:\s+[A-Za-z]{2,20})?)/i) ||
          text.match(/(?:i\s*am|this\s*is)\s+([A-Za-z]{2,20}(?:\s+[A-Za-z]{2,20})?)/i);

        if (parentMatch && !/^(?:interested|parent|father|mother|ready|looking|here|booking)$/i.test(parentMatch[1].trim())) {
          parentName = parentMatch[1].trim();
          customerName = parentName;
          explicitNameProvided = true;
        } else {
          // Check for "for Name" pattern (e.g. "for Hitendra")
          const forMatch = text.match(/\bfor\s+([A-Z][a-z]{2,20})\b/);
          if (forMatch && !/^(?:my|him|her|son|daughter|child|kid|children|demo|class|abacus|rubik|online|offline|booking)$/i.test(forMatch[1].trim())) {
            parentName = forMatch[1].trim();
            customerName = parentName;
            explicitNameProvided = true;
          }
        }
      }

      // Pair Extraction (e.g. "Parent: Amit, Child: Aarav" or "Amit and Aarav")
      if ((!parentName || !childName) && isChildCourse) {
        const pairMatch =
          text.match(/(?:1\.?\s*)?(?:parent(?:'s)?(?:\s*name)?\s*:?\s*)([A-Za-z]{2,20})\b[\s,;]+(?:2\.?\s*)?(?:child(?:'s)?(?:\s*name)?\s*:?\s*)([A-Za-z]{2,20})/i) ||
          text.match(/\b([A-Z][a-z]{2,15})\s+(?:and|,)\s+([A-Z][a-z]{2,15})\b/);

        if (pairMatch) {
          const n1 = pairMatch[1].trim();
          const n2 = pairMatch[2].trim();
          if (
            !/^(?:please|thank|hello|today|tomorrow|monday|tuesday|wednesday|thursday|friday|saturday|sunday)$/i.test(n1) &&
            !/^(?:please|thank|hello|today|tomorrow|monday|tuesday|wednesday|thursday|friday|saturday|sunday)$/i.test(n2)
          ) {
            if (!parentName) {
              parentName = n1;
              customerName = n1;
              explicitNameProvided = true;
            }
            if (!childName) {
              childName = n2;
            }
          }
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
      // Determine what the assistant previously asked or offered
      const lower = text.toLowerCase();
      if (lower.includes('child') && (lower.includes('name') || lower.includes('who is'))) {
        lastQuestionAsked = 'ASKED_CHILD_NAME';
      } else if (lower.includes('parent') && (lower.includes('name') || lower.includes('who is'))) {
        lastQuestionAsked = 'ASKED_PARENT_NAME';
      } else if (lower.includes('email') || lower.includes('calendar invite') || lower.includes('best email')) {
        lastQuestionAsked = 'ASKED_EMAIL';
      } else if (didAssistantAskForSlot(text) || lower.includes('what day and time') || lower.includes('which day') || lower.includes('what time')) {
        lastQuestionAsked = 'ASKED_DATE_TIME';
      } else if (lower.includes('what name') || lower.includes('your name') || lower.includes('may i know your name')) {
        lastQuestionAsked = 'ASKED_NAME';
      } else if (lower.includes('which one would you like') || lower.includes('we offer both')) {
        lastQuestionAsked = 'ASKED_SERVICE_SELECTION';
      } else if (didAssistantOfferCallOrDemo(text)) {
        lastQuestionAsked = 'OFFERED_CALL';
      }
    }
  }

  // Check if assistant offered call and customer accepted
  const assistantOfferedCall = lastQuestionAsked === 'OFFERED_CALL';
  let customerAcceptedCall = false;
  let conversationState: ConversationBookingState = 'INITIAL';

  const lastUserMsg = [...messages].reverse().find((m) => m.role === 'user')?.content;
  if (assistantOfferedCall && lastUserMsg && isAffirmativeReply(lastUserMsg)) {
    customerAcceptedCall = true;
    conversationState = 'AWAITING_PREFERRED_SLOT';
  } else if (lastQuestionAsked === 'ASKED_DATE_TIME') {
    conversationState = 'AWAITING_PREFERRED_SLOT';
  } else if (assistantOfferedCall) {
    conversationState = 'OFFERED_CALL_OR_DEMO';
  }

  // Fallback to contactRecord name if no explicit in-chat name provided, but keep explicitNameProvided flag accurate
  if (!customerName && contactRecord?.name) {
    if (!/^(?:parent|customer|there|test|lead|user|\+\d+)$/i.test(contactRecord.name.trim())) {
      customerName = contactRecord.name.trim();
    }
  }

  return {
    customerName,
    parentName,
    childName,
    explicitNameProvided,
    email,
    noEmailExplicitlyStated,
    phone: contactRecord?.phone || null,
    childAge,
    isChildCourse,
    preferredTimeText,
    hasDate,
    hasTime,
    lastQuestionAsked,
    conversationState,
    assistantOfferedCall,
    customerAcceptedCall,
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

/**
 * Persists an explicit state transition to the database (ai_action_logs).
 */
export async function persistConversationState(
  db: SupabaseClient,
  accountId: string,
  contactId?: string | null,
  conversationId?: string | null,
  stateData?: Partial<PersistedConversationState>,
): Promise<void> {
  if (!conversationId) return;
  try {
    const existing = await getPersistedConversationState(db, conversationId);
    const merged = {
      ...(existing || {}),
      ...(stateData || {}),
      updatedAt: new Date().toISOString(),
    };
    await logAiAction({
      db,
      accountId,
      contactId,
      conversationId,
      action: 'STATE_TRANSITION',
      details: merged,
    });
  } catch (err) {
    console.warn('[conversation-state] persistConversationState non-fatal error:', err);
  }
}

/**
 * Loads the latest persisted conversation state from ai_action_logs.
 */
export async function getPersistedConversationState(
  db: SupabaseClient,
  conversationId: string,
): Promise<PersistedConversationState | null> {
  try {
    const { data, error } = await db
      .from('ai_action_logs')
      .select('details, created_at')
      .eq('conversation_id', conversationId)
      .eq('action', 'STATE_TRANSITION')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error || !data?.details) return null;
    return data.details as PersistedConversationState;
  } catch {
    return null;
  }
}

/**
 * Deterministically derives the conversation booking state and product context
 * from the transcript history and/or DB persisted state.
 */
export function deriveConversationState(
  messages: Array<{ role: string; content: string }>,
  persistedState?: PersistedConversationState | null,
  catalogue?: TenantProductConfig[],
): PersistedConversationState {
  let state: ConversationBookingState = persistedState?.state || 'INITIAL';
  let productKey: string | null = persistedState?.productKey || null;
  let appointmentType: string | null = persistedState?.appointmentType || null;
  let selectedProducts: string[] = persistedState?.selectedProducts || (productKey ? [productKey] : []);

  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i];
    if (msg.role === 'assistant') {
      const lower = msg.content.toLowerCase();
      if (lower.includes('is booked') || lower.includes('has been rescheduled')) {
        state = 'BOOKED';
      } else if (didAssistantAskForSlot(msg.content)) {
        state = 'AWAITING_PREFERRED_SLOT';
      } else if (didAssistantOfferCallOrDemo(msg.content)) {
        state = 'OFFERED_CALL_OR_DEMO';
      }

      if (catalogue && catalogue.length > 0) {
        for (const prod of catalogue) {
          if (
            lower.includes(prod.name.toLowerCase()) ||
            lower.includes(prod.appointmentType.toLowerCase())
          ) {
            productKey = prod.productKey || prod.productServiceId;
            appointmentType = prod.appointmentType;
            if (!selectedProducts.includes(productKey)) selectedProducts.push(productKey);
            break;
          }
        }
      } else {
        if (lower.includes('gtc') || lower.includes('teacher training') || lower.includes('training advisor')) {
          productKey = 'GTC';
          appointmentType = 'GTC Training / Business Call';
        } else if (lower.includes('abacus demo') || lower.includes('abacus mental math')) {
          productKey = 'ABACUS_KIDS';
          appointmentType = 'Free Abacus Demo';
        } else if (lower.includes('rubik')) {
          productKey = 'RUBIKS_CUBE';
          appointmentType = "Rubik's Cube Demo";
        } else if (lower.includes('growth call') || lower.includes('gold')) {
          productKey = 'GOLD';
          appointmentType = 'Gold Business Growth Call';
        } else if (lower.includes('maa')) {
          productKey = 'MAA';
          appointmentType = 'MAA Product Demo';
        } else if (lower.includes('lead pilot')) {
          productKey = 'LEAD_PILOT';
          appointmentType = 'Lead Pilot Demo / Call';
        }
        if (productKey && !selectedProducts.includes(productKey)) selectedProducts.push(productKey);
      }
    } else if (msg.role === 'user') {
      if ((state === 'OFFERED_CALL_OR_DEMO' || state === 'INITIAL') && isAffirmativeReply(msg.content)) {
        // If the immediately preceding assistant message offered a call/demo, advance to AWAITING_PREFERRED_SLOT
        const priorAssistant = messages.slice(0, i).reverse().find((m) => m.role === 'assistant');
        if (priorAssistant && didAssistantOfferCallOrDemo(priorAssistant.content)) {
          state = 'AWAITING_PREFERRED_SLOT';
        }
      }
    }
  }

  return {
    ...persistedState,
    state,
    productKey,
    appointmentType,
    selectedProducts,
  };
}
