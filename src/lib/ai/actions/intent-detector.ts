import {
  type DetectedIntents,
  type ProductKey,
  type StageTagName,
  type ScoringSignal,
  type LeadTemperature,
} from './types';
import {
  hasDateSpecified,
  hasTimeSpecified,
  extractChildAge,
} from '@/lib/calendar/date-parser';
import { extractEmailFromText } from '@/lib/calendar/booking-coordinator';
import type { ChatMessage } from '@/lib/ai/types';

/**
 * Detects product intent from current message and recent conversation turns.
 */
export function detectProductIntent(text: string): ProductKey[] {
  const lower = text.toLowerCase();
  const detected: ProductKey[] = [];

  // 1. ABACUS_KIDS
  if (
    lower.includes('abacus class') ||
    lower.includes('abacus for') ||
    lower.includes('abacus kids') ||
    lower.includes('mental math') ||
    (lower.includes('abacus') && (lower.includes('child') || lower.includes('kid') || lower.includes('son') || lower.includes('daughter') || lower.includes('year old')))
  ) {
    detected.push('ABACUS_KIDS');
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
 * Analyzes conversation turns and inbound message to extract all structured intents,
 * tags, scoring signals, temperature, and booking parameters.
 */
export function analyzeCustomerIntent(args: {
  currentText: string;
  messages: ChatMessage[];
  existingTags?: string[];
  contactEmail?: string | null;
  referenceDate?: Date;
}): DetectedIntents {
  const { currentText, messages, contactEmail } = args;
  const lower = currentText.toLowerCase();

  // Combine recent customer texts for context
  const customerHistory = messages
    .filter((m) => m.role === 'user')
    .map((m) => m.content)
    .join(' \n ');
  const combinedCustomerText = `${customerHistory}\n${currentText}`;

  // 1. Detect products
  const products = detectProductIntent(currentText);
  if (products.length === 0) {
    const historicalProducts = detectProductIntent(customerHistory);
    products.push(...historicalProducts);
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
    lower.includes('talk to a human') ||
    lower.includes('speak to human') ||
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
    lower.includes('yes book') ||
    lower.includes('yes, book') ||
    lower.includes('see a demo') ||
    lower.includes('product demo') ||
    lower.includes('abacus demo');
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
    lower.includes('call me');
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

  // Confirmation of appointment
  const dateSpecified = hasDateSpecified(currentText);
  const timeSpecified = hasTimeSpecified(currentText);
  const hasBothDateAndTime = dateSpecified && timeSpecified;
  const hasOnlyDate = dateSpecified && !timeSpecified;
  const hasOnlyTime = !dateSpecified && timeSpecified;

  if (hasBothDateAndTime) {
    signals.push('confirms_appointment');
  }

  // Follow-up required
  if (
    lower.includes('call me later') ||
    lower.includes('busy right now') ||
    lower.includes('next week') ||
    lower.includes('follow up')
  ) {
    stageTagsToAdd.push('FOLLOW_UP_REQUIRED');
  }

  // 3. Lead Temperature Classification
  let temperature: LeadTemperature | undefined = undefined;

  const isHot =
    asksPayment ||
    readyToJoin ||
    lower.includes('i want to join') ||
    lower.includes('i want to enroll') ||
    lower.includes('book my demo') ||
    lower.includes('send me the payment link') ||
    lower.includes('i want to start') ||
    lower.includes('pay and join');

  const isWarm =
    asksPricing ||
    lower.includes('i am interested') ||
    lower.includes('how does it work') ||
    lower.includes('send me details') ||
    lower.includes('explain the program') ||
    requestsDemo ||
    requestsCall ||
    products.length > 0;

  const isCold =
    lower.includes('just checking') ||
    lower.includes('not interested') ||
    lower.includes('maybe later');

  if (isHot) {
    temperature = 'hot';
  } else if (isWarm) {
    temperature = 'warm';
  } else if (isCold) {
    temperature = 'cold';
  }

  // 4. Extract booking metadata
  const email = extractEmailFromText(currentText) || contactEmail || null;
  const childAge = extractChildAge(combinedCustomerText);

  // Check if ready to book
  const isReadyToBook =
    (requestsDemo || requestsCall || hasBothDateAndTime || lower.includes('book')) &&
    (dateSpecified || timeSpecified);

  // Derive customer type and pain point
  let customerType = 'Parent / Customer';
  let painPoint = '';

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
    stageTagsToAdd,
    signals,
    temperature,
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
  };
}
