import {
  type DetectedIntents,
  type ProductKey,
  type StageTagName,
  type ScoringSignal,
  type LeadTemperature,
  type TenantProductConfig,
  GENIPLUS_SEED_PRODUCTS,
} from './types';
import {
  hasDateSpecified,
  hasTimeSpecified,
  extractChildAge,
} from '@/lib/calendar/date-parser';
import { extractEmailFromText } from '@/lib/calendar/booking-coordinator';
import type { ChatMessage } from '@/lib/ai/types';

export interface ProductDetectionResult {
  products: ProductKey[];
  matchingConfigs: TenantProductConfig[];
  isAmbiguous: boolean;
  clarifyingQuestion?: string;
}

/**
 * Normalizes text for matching by lowercasing and trimming punctuation.
 */
function cleanText(text: string): string {
  return text.toLowerCase().replace(/[.,/#!$%^&*;:{}=\-_`~()?]/g, ' ').replace(/\s+/g, ' ').trim();
}

/**
 * Calculates a match score for a given product config against user text.
 */
export function scoreProductMatch(text: string, product: TenantProductConfig): number {
  if (product.enabled === false) return 0;

  const lower = text.toLowerCase();
  const cleaned = ` ${cleanText(text)} `;
  let score = 0;

  // 1. Check explicit keywords
  if (Array.isArray(product.keywords) && product.keywords.length > 0) {
    for (const kw of product.keywords) {
      const kwLower = kw.toLowerCase().trim();
      if (!kwLower) continue;
      if (lower.includes(kwLower)) {
        score += kwLower.includes(' ') ? 40 : 25;
      }
    }
  }

  // 2. Check product name
  const nameLower = product.name.toLowerCase();
  if (lower.includes(nameLower)) {
    score += 50;
  } else {
    // Individual words of product name
    const nameWords = cleanText(product.name).split(' ').filter((w) => w.length > 3);
    for (const w of nameWords) {
      if (cleaned.includes(` ${w} `)) {
        score += 15;
      }
    }
  }

  // 3. Check appointment type
  const apptLower = product.appointmentType.toLowerCase();
  if (lower.includes(apptLower)) {
    score += 45;
  }

  // 4. Check description & category
  if (product.description) {
    const descLower = product.description.toLowerCase();
    // Common intent phrases in description (e.g. "more clients", "personal training", "brain development")
    const descPhrases = descLower.split(/[,.;]/).map((p) => p.trim()).filter((p) => p.length > 5);
    for (const phrase of descPhrases) {
      if (lower.includes(phrase)) {
        score += 30;
      }
    }

    const descWords = cleanText(product.description).split(' ').filter((w) => w.length > 4);
    for (const w of descWords) {
      if (cleaned.includes(` ${w} `)) {
        score += 8;
      }
    }
  }

  if (product.category && lower.includes(product.category.toLowerCase())) {
    score += 20;
  }

  // 5. Product Key / ID exact match
  const keyLower = product.productServiceId.toLowerCase().replace(/[_-]/g, ' ');
  if (cleaned.includes(` ${keyLower} `)) {
    score += 35;
  }

  return score;
}

/**
 * Dynamically detects product intent using the tenant's configured catalogue.
 * If ambiguous between multiple products, returns clarifying question.
 */
export function detectTenantProductIntent(
  text: string,
  catalogue: TenantProductConfig[],
): ProductDetectionResult {
  if (!catalogue || catalogue.length === 0) {
    return {
      products: [],
      matchingConfigs: [],
      isAmbiguous: false,
    };
  }

  const scored = catalogue
    .map((prod) => ({
      product: prod,
      score: scoreProductMatch(text, prod),
    }))
    .filter((item) => item.score >= 20)
    .sort((a, b) => b.score - a.score);

  if (scored.length === 0) {
    return {
      products: [],
      matchingConfigs: [],
      isAmbiguous: false,
    };
  }

  const topScore = scored[0].score;
  const topMatches = scored.filter((item) => item.score >= topScore * 0.75);

  // If two distinct products have almost identical high score, flag ambiguity
  if (topMatches.length >= 2 && topMatches[0].product.productServiceId !== topMatches[1].product.productServiceId) {
    const p1 = topMatches[0].product.name;
    const p2 = topMatches[1].product.name;
    return {
      products: topMatches.map((m) => m.product.productServiceId),
      matchingConfigs: topMatches.map((m) => m.product),
      isAmbiguous: true,
      clarifyingQuestion: `We offer both ${p1} and ${p2}. Which one would you like to explore?`,
    };
  }

  return {
    products: [scored[0].product.productServiceId],
    matchingConfigs: [scored[0].product],
    isAmbiguous: false,
  };
}

/**
 * Detects product intent from current message and recent conversation turns.
 * Supports dynamic tenant catalogue while maintaining 100% backward compatibility
 * when no catalogue is passed (falls back to Geniplus seed rules).
 */
export function detectProductIntent(
  text: string,
  catalogue?: TenantProductConfig[],
): ProductKey[] {
  // If a tenant catalogue is supplied (even if empty for a new coach), use dynamic tenant matching!
  if (catalogue !== undefined) {
    const res = detectTenantProductIntent(text, catalogue);
    return res.products;
  }

  // FALLBACK FOR LEGACY CALLS WITHOUT CATALOGUE (e.g. Geniplus default tests):
  const lower = text.toLowerCase();
  const detected: ProductKey[] = [];

  // 1. ABACUS_KIDS
  if (
    lower.includes('abacus class') ||
    lower.includes('abacus for') ||
    lower.includes('abacus kids') ||
    lower.includes('abacus demo') ||
    lower.includes('mental math') ||
    (lower.includes('abacus') && (lower.includes('child') || lower.includes('kid') || lower.includes('son') || lower.includes('daughter') || lower.includes('year old'))) ||
    lower.includes('book demo for my') ||
    lower.includes('book a demo for my') ||
    lower.includes('demo for my son') ||
    lower.includes('demo for my kid') ||
    lower.includes('demo for my child') ||
    lower.includes('demo for my daughter') ||
    lower.includes('trial for my son') ||
    lower.includes('trial for my kid') ||
    lower.includes('trial for my child') ||
    lower.includes('trial class for my son') ||
    lower.includes('demo class for my son') ||
    lower.includes('trial class for my kid') ||
    lower.includes('demo class for my kid') ||
    lower.includes('class for my son') ||
    lower.includes('class for my kid') ||
    lower.includes('class for my daughter') ||
    (lower.includes('demo') && lower.includes('year old')) ||
    (lower.includes('trial') && lower.includes('year old')) ||
    (lower.includes('demo') && (lower.includes('son') || lower.includes('kid') || lower.includes('child') || lower.includes('daughter'))) ||
    (lower.includes('trial') && (lower.includes('son') || lower.includes('kid') || lower.includes('child') || lower.includes('daughter'))) ||
    (lower.includes('class') && (lower.includes('son') || lower.includes('kid') || lower.includes('child') || lower.includes('daughter')))
  ) {
    if (!lower.includes('teach') && !lower.includes('teacher training') && !lower.includes('gtc')) {
      detected.push('ABACUS_KIDS');
    }
  }

  // 2. GTC (Teacher Training / start classes)
  if (
    lower.includes('abacus teach') ||
    lower.includes('start my own abacus') ||
    lower.includes('start abacus class') ||
    lower.includes('teacher training') ||
    lower.includes('gtc') ||
    lower.includes('become an abacus teacher') ||
    lower.includes('abacus trainer') ||
    (lower.includes('abacus') && (lower.includes('start teaching') || lower.includes('teach abacus') || (lower.includes('learn') && lower.includes('teach'))))
  ) {
    detected.push('GTC');
  }

  // 3. RUBIKS_CUBE
  if (
    lower.includes('rubik') ||
    lower.includes("rubik's cube") ||
    lower.includes('speedcubing') ||
    lower.includes('cube class') ||
    lower.includes('solve cube')
  ) {
    detected.push('RUBIKS_CUBE');
  }

  // 4. GOLD (Business Growth for Coaching)
  if (
    lower.includes('grow my coaching') ||
    lower.includes('coaching business') ||
    (lower.includes('coach') && lower.includes('students') && (lower.includes('leads') || lower.includes('sales') || lower.includes('scale'))) ||
    lower.includes('gold program') ||
    lower.includes('gold interest') ||
    lower.includes('more leads and better sales')
  ) {
    detected.push('GOLD');
  }

  // 5. MAA (My Abacus Academy Software)
  if (
    lower.includes('software to manage') ||
    lower.includes('app to manage') ||
    lower.includes('manage my abacus academy') ||
    lower.includes('academy software') ||
    lower.includes('student and fee management') ||
    lower.includes('academy management') ||
    lower.includes('maa')
  ) {
    detected.push('MAA');
  }

  // 6. LEAD_PILOT (WhatsApp CRM / Automation for coaches)
  if (
    lower.includes('whatsapp automation') ||
    lower.includes('automation for my leads') ||
    lower.includes('automation for my coaching leads') ||
    lower.includes('lead pilot') ||
    lower.includes('leadpilot') ||
    lower.includes('whatsapp crm') ||
    lower.includes('leads automation')
  ) {
    detected.push('LEAD_PILOT');
  }

  return detected;
}

/**
 * Extracts a customer / parent name from conversational messages.
 * Recognizes explicit declarations ("My name is Hitendra") or direct replies to "What name should I use?".
 */
export function extractCustomerName(
  currentText: string,
  messages: ChatMessage[] = [],
): { name: string | null; isExplicit: boolean } {
  const trimmed = currentText.trim();
  const lower = trimmed.toLowerCase();

  // 1. Explicit declaration: "My name is Hitendra", "I am Hitendra", "Name: Hitendra", "This is Hitendra", "Hitendra here"
  const m1 = trimmed.match(/(?:my name is|i am|i'm|name is|this is|call me|name:?)\s+([A-Za-z\s.'-]{2,30})/i);
  if (m1) {
    const raw = m1[1].replace(/[.,!?;:]+$/, '').trim();
    if (!/^(?:a|the|an|ready|interested|booking|demo|call)$/i.test(raw)) {
      return { name: raw, isExplicit: true };
    }
  }

  // 2. Direct name reply: If assistant recently asked for name
  const lastAssistantMsg = messages
    .filter((m) => m.role === 'assistant')
    .slice(-1)[0]?.content?.toLowerCase();

  if (
    lastAssistantMsg &&
    (lastAssistantMsg.includes('what name') ||
      lastAssistantMsg.includes('name should i use') ||
      lastAssistantMsg.includes('your name') ||
      lastAssistantMsg.includes('parent name') ||
      lastAssistantMsg.includes('who should i book'))
  ) {
    // If user's text is 1 to 4 clean words (not an email, no dates/times)
    if (
      !trimmed.includes('@') &&
      !/\b(?:am|pm|today|tomorrow|monday|tuesday|wednesday|thursday|friday|saturday|sunday|january|february|march|april|may|june|july|august|september|october|november|december)\b/i.test(lower) &&
      /^[A-Za-z\s.'-]{2,40}$/.test(trimmed)
    ) {
      return { name: trimmed.replace(/[.,!?;:]+$/, '').trim(), isExplicit: true };
    }
  }

  // 3. Historical search in user messages for explicit name declaration
  for (const m of messages.filter((msg) => msg.role === 'user')) {
    const histMatch = m.content.match(/(?:my name is|i am|i'm|name is|this is|call me|name:?)\s+([A-Za-z\s.'-]{2,30})/i);
    if (histMatch) {
      const raw = histMatch[1].replace(/[.,!?;:]+$/, '').trim();
      if (!/^(?:a|the|an|ready|interested|booking|demo|call)$/i.test(raw)) {
        return { name: raw, isExplicit: true };
      }
    }
  }

  // 4. Historical search: did user answer a previous "What name should I use" question?
  for (let i = 0; i < messages.length - 1; i++) {
    const msg = messages[i];
    const nextMsg = messages[i + 1];
    if (msg.role === 'assistant' && nextMsg.role === 'user') {
      const aLower = msg.content.toLowerCase();
      if (
        aLower.includes('what name') ||
        aLower.includes('name should i use') ||
        aLower.includes('your name') ||
        aLower.includes('parent name')
      ) {
        const uTrim = nextMsg.content.trim();
        const uLower = uTrim.toLowerCase();
        if (
          !uTrim.includes('@') &&
          !/\b(?:am|pm|today|tomorrow|monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/i.test(uLower) &&
          /^[A-Za-z\s.'-]{2,40}$/.test(uTrim)
        ) {
          return { name: uTrim, isExplicit: true };
        }
      }
    }
  }

  return { name: null, isExplicit: false };
}

/**
 * Analyzes conversation turns and inbound message to extract all structured intents,
 * tags, scoring signals, temperature, and booking parameters.
 */
export function analyzeCustomerIntent(args: {
  currentText: string;
  messages?: ChatMessage[];
  existingTags?: string[];
  contactEmail?: string | null;
  referenceDate?: Date;
  catalogue?: TenantProductConfig[];
}): DetectedIntents {
  const { currentText, messages = [], contactEmail, catalogue } = args;
  const lower = currentText.toLowerCase();

  // Combine recent customer texts for context
  const customerHistory = messages
    .filter((m) => m.role === 'user')
    .map((m) => m.content)
    .join(' \n ');
  const combinedCustomerText = `${customerHistory}\n${currentText}`;

  // Extract customer name
  const { name: customerName, isExplicit: explicitNameProvided } = extractCustomerName(currentText, messages);

  // 1. Detect products dynamically using tenant catalogue if available
  let products: ProductKey[] = [];
  let matchingConfigs: TenantProductConfig[] = [];
  let isAmbiguousProduct = false;
  let clarifyingQuestion: string | undefined = undefined;

  if (catalogue && catalogue.length > 0) {
    const det = detectTenantProductIntent(currentText, catalogue);
    products = det.products;
    matchingConfigs = det.matchingConfigs;
    isAmbiguousProduct = det.isAmbiguous;
    clarifyingQuestion = det.clarifyingQuestion;

    if (products.length === 0 && customerHistory) {
      const histDet = detectTenantProductIntent(customerHistory, catalogue);
      products = histDet.products;
      matchingConfigs = histDet.matchingConfigs;
      if (!isAmbiguousProduct && histDet.isAmbiguous) {
        isAmbiguousProduct = true;
        clarifyingQuestion = histDet.clarifyingQuestion;
      }
    }
  } else {
    products = detectProductIntent(currentText);
    if (products.length === 0 && customerHistory) {
      const historicalProducts = detectProductIntent(customerHistory);
      products.push(...historicalProducts);
    }
  }

  // 2. Identify signals & stage tags
  const signals: ScoringSignal[] = [];
  const stageTagsToAdd: StageTagName[] = [];

  if (products.length > 0) {
    signals.push('product_identified');
    stageTagsToAdd.push('INTERESTED');
  }

  // Human handoff
  const isHumanHandoffRequested =
    lower.includes('speak to a person') ||
    lower.includes('talk to a person') ||
    lower.includes('talk to a human') ||
    lower.includes('speak to a human') ||
    lower.includes('speak to human') ||
    lower.includes('human coach') ||
    lower.includes('speak to coach') ||
    lower.includes('talk to coach') ||
    lower.includes('speak to a coach') ||
    lower.includes('talk to a coach') ||
    lower.includes('speak to someone') ||
    lower.includes('talk to someone') ||
    lower.includes('talk to an agent') ||
    lower.includes('speak to agent') ||
    lower.includes('real person') ||
    lower.includes('customer care') ||
    lower.includes('customer support');

  if (isHumanHandoffRequested) {
    stageTagsToAdd.push('HUMAN_HANDOFF');
  }

  // Pricing ask
  const asksPricing =
    lower.includes('fee') ||
    lower.includes('pricing') ||
    lower.includes('cost') ||
    lower.includes('price') ||
    lower.includes('charges') ||
    lower.includes('how much');
  if (asksPricing) {
    signals.push('asks_pricing');
  }

  // Enrollment / Start ask
  const asksEnrollment =
    lower.includes('how to enroll') ||
    lower.includes('how can i enroll') ||
    lower.includes('want to enroll') ||
    lower.includes('want to join') ||
    lower.includes('admission process') ||
    lower.includes('start classes') ||
    lower.includes('i want to start');
  if (asksEnrollment) {
    signals.push('asks_enrollment');
    stageTagsToAdd.push('ENROLLMENT_INTEREST');
  }

  // Demo requested
  const requestsDemo =
    lower.includes('book the demo') ||
    lower.includes('book my demo') ||
    lower.includes('book a demo') ||
    lower.includes('free demo') ||
    lower.includes('trial class') ||
    lower.includes('demo class') ||
    lower.includes('trial for') ||
    lower.includes('demo for') ||
    lower.includes('trial class for my son') ||
    lower.includes('demo class for my son') ||
    lower.includes('yes book') ||
    lower.includes('yes, book') ||
    lower.includes('see a demo') ||
    lower.includes('product demo') ||
    lower.includes('abacus demo') ||
    (lower.includes('demo') && (lower.includes('class') || lower.includes('session') || lower.includes('book') || lower.includes('son') || lower.includes('kid'))) ||
    (lower.includes('trial') && (lower.includes('class') || lower.includes('session') || lower.includes('book') || lower.includes('son') || lower.includes('kid')));
  if (requestsDemo) {
    signals.push('requests_demo_or_call');
    stageTagsToAdd.push('DEMO_REQUESTED');
  }

  // Call requested
  const requestsCall =
    lower.includes('book a call') ||
    lower.includes('schedule a call') ||
    lower.includes('talk on call') ||
    lower.includes('request a call') ||
    lower.includes('call me') ||
    /book\s+(?:a|an)?\s*(?:intro|discovery|strategy)?\s*call/.test(lower) ||
    /schedule\s+(?:a|an)?\s*(?:intro|discovery|strategy)?\s*(?:call|appointment|session)/.test(lower) ||
    lower.includes('self-scheduling') ||
    lower.includes('booking page');
  if (requestsCall) {
    signals.push('requests_demo_or_call');
    stageTagsToAdd.push('CALL_REQUESTED');
  }

  // Payment ask
  const asksPayment =
    lower.includes('how can i pay') ||
    lower.includes('how do i pay') ||
    lower.includes('payment link') ||
    lower.includes('send payment link') ||
    lower.includes('want to pay') ||
    lower.includes('i want to pay and join') ||
    lower.includes('pay online');
  if (asksPayment) {
    signals.push('asks_payment');
    stageTagsToAdd.push('ENROLLMENT_INTEREST');
  }

  // Ready to join
  const readyToJoin =
    lower.includes('ready to join') ||
    lower.includes('ready to start') ||
    lower.includes('i am ready') ||
    lower.includes("i'm ready") ||
    lower.includes('count me in');
  if (readyToJoin) {
    signals.push('ready_to_join');
    stageTagsToAdd.push('ENROLLMENT_INTEREST');
  }

  // Confirmation of appointment across current text and conversation history
  const currentHasDate = hasDateSpecified(currentText);
  const currentHasTime = hasTimeSpecified(currentText);
  const historyHasDate = hasDateSpecified(customerHistory);
  const historyHasTime = hasTimeSpecified(customerHistory);

  const dateSpecified = currentHasDate || historyHasDate;
  const timeSpecified = currentHasTime || historyHasTime;
  const hasBothDateAndTime = (currentHasDate && currentHasTime) || (dateSpecified && timeSpecified);
  const hasOnlyDate = dateSpecified && !timeSpecified;
  const hasOnlyTime = !dateSpecified && timeSpecified;

  if (currentHasDate && currentHasTime) {
    signals.push('confirms_appointment');
  } else if (hasBothDateAndTime && (currentHasDate || currentHasTime)) {
    signals.push('confirms_appointment');
  }

  // Slot check / reschedule intent (e.g. "Can you check 5pm if possible", "check 6 PM instead")
  const isSlotCheckOrReschedule =
    (lower.includes('check') ||
      lower.includes('instead') ||
      lower.includes('reschedule') ||
      lower.includes('change') ||
      lower.includes('move to') ||
      lower.includes('possible') ||
      lower.includes('available')) &&
    currentHasTime;

  // Follow-up required
  if (
    lower.includes('call me later') ||
    lower.includes('busy right now') ||
    lower.includes('next week') ||
    lower.includes('follow up')
  ) {
    stageTagsToAdd.push('FOLLOW_UP_REQUIRED');
  }

  // 3. Extract booking metadata
  const email =
    extractEmailFromText(currentText) ||
    extractEmailFromText(customerHistory) ||
    contactEmail ||
    null;
  const childAge = extractChildAge(combinedCustomerText);

  const requestedDateText = currentHasDate
    ? currentText
    : historyHasDate
    ? customerHistory
    : null;
  const requestedTimeText = currentHasTime
    ? currentText
    : historyHasTime
    ? customerHistory
    : null;

  // 4. Lead Temperature Classification
  let temperature: LeadTemperature | undefined = undefined;

  const hasDemoOrCallInHistory = /demo|trial|book|call/i.test(combinedCustomerText);
  const isHot =
    requestsDemo ||
    requestsCall ||
    hasDemoOrCallInHistory ||
    asksEnrollment ||
    asksPayment ||
    readyToJoin ||
    Boolean(email && (dateSpecified || timeSpecified)) ||
    hasBothDateAndTime ||
    lower.includes('i want to join') ||
    lower.includes('i want to enroll') ||
    lower.includes('book my demo') ||
    lower.includes('send me the payment link') ||
    lower.includes('i want to start') ||
    lower.includes('pay and join');

  const isWarm =
    !isHot &&
    (asksPricing ||
      lower.includes('i am interested') ||
      lower.includes('how does it work') ||
      lower.includes('send me details') ||
      lower.includes('explain the program') ||
      products.length > 0);

  const isCold =
    !isHot &&
    !isWarm &&
    (lower.includes('just checking') ||
      lower.includes('not interested') ||
      lower.includes('maybe later'));

  if (isHot) {
    temperature = 'hot';
  } else if (isWarm) {
    temperature = 'warm';
  } else if (isCold) {
    temperature = 'cold';
  }

  // Check if ready to book
  const isReadyToBook =
    (requestsDemo || requestsCall || hasBothDateAndTime || lower.includes('book')) &&
    (dateSpecified || timeSpecified);

  // Derive customer type and pain point
  let customerType = 'Customer';
  let painPoint = '';

  if (matchingConfigs.length > 0) {
    const top = matchingConfigs[0];
    customerType = top.category ? `${top.category} Client` : 'Client';
    painPoint = top.description || top.appointmentType || top.name;
  }

  // Backward compatibility overrides for Geniplus programs
  if (products.includes('ABACUS_KIDS')) {
    customerType = 'Parent';
    painPoint = childAge ? `Abacus mental math classes for ${childAge}-year-old child` : 'Abacus classes for child';
  } else if (products.includes('GTC')) {
    customerType = 'Aspiring Teacher / Entrepreneur';
    painPoint = 'Wants to learn Abacus teaching and start classes';
  } else if (products.includes('RUBIKS_CUBE')) {
    customerType = 'Parent / Student';
    painPoint = 'Wants Rubik\'s Cube training';
  } else if (products.includes('GOLD')) {
    customerType = 'Coaching Academy Owner';
    painPoint = 'Needs business growth, lead generation, and academy scaling';
  } else if (products.includes('MAA')) {
    customerType = 'Abacus Academy Owner';
    painPoint = 'Needs software for academy student and fee management';
  } else if (products.includes('LEAD_PILOT')) {
    customerType = 'Coach / Trainer';
    painPoint = 'Needs WhatsApp CRM and automated lead follow-up';
  }

  return {
    products,
    matchingConfigs,
    isAmbiguousProduct,
    clarifyingQuestion,
    stageTagsToAdd,
    signals,
    temperature,
    customerName,
    explicitNameProvided,
    requestedDateText: dateSpecified ? currentText : null,
    requestedTimeText: timeSpecified ? currentText : null,
    email,
    childAge,
    customerType,
    painPoint,
    isHumanHandoffRequested,
    isReadyToBook,
    hasBothDateAndTime,
    hasOnlyDate,
    hasOnlyTime,
    isSlotCheckOrReschedule,
  };
}
