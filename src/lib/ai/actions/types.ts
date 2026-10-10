// ============================================================
// AI Agent Action System Types
// ============================================================

export type LegacyProductKey =
  | 'ABACUS_KIDS'
  | 'GTC'
  | 'RUBIKS_CUBE'
  | 'GOLD'
  | 'MAA'
  | 'LEAD_PILOT';

export type ProductKey = LegacyProductKey | (string & {});

export type LegacyProductTagName =
  | 'ABACUS_KIDS_INTEREST'
  | 'GTC_INTEREST'
  | 'RUBIKS_CUBE_INTEREST'
  | 'GOLD_INTEREST'
  | 'MAA_INTEREST'
  | 'LEAD_PILOT_INTEREST';

export type ProductTagName = LegacyProductTagName | (string & {});

export type StageTagName =
  | 'INTERESTED'
  | 'DEMO_REQUESTED'
  | 'DEMO_BOOKED'
  | 'DEMO_ATTENDED'
  | 'CALL_REQUESTED'
  | 'CALL_BOOKED'
  | 'ENROLLMENT_INTEREST'
  | 'PURCHASED'
  | 'HUMAN_HANDOFF'
  | 'FOLLOW_UP_REQUIRED';

export type TemperatureTagName =
  | 'COLD_LEAD'
  | 'WARM_LEAD'
  | 'HOT_LEAD';

export type LeadTemperature = 'cold' | 'warm' | 'hot';

export type MeetingLinkMode =
  | 'GOOGLE_MEET'
  | 'ZOOM'
  | 'STATIC_MEETING_LINK'
  | 'BOOKING_PAGE'
  | 'PHONE_CALL'
  | 'NONE'
  | 'MANUAL_FOLLOW_UP';

export type SupportedBookingMethod =
  | 'google_calendar'
  | 'zoom'
  | 'static_meeting_link'
  | 'booking_page'
  | 'phone_call'
  | 'manual_followup';

export interface ProductTagMapping {
  interestTag?: string;
  requestedTag?: string;
  bookedTag?: string;
  purchasedTag?: string;
}

export interface TenantProductConfig {
  productServiceId: string;
  tenantId?: string;
  name: string;
  description?: string;
  category?: string;
  targetAudience?: string;
  enabled?: boolean;
  archived?: boolean;
  appointmentType: string;
  durationMinutes: number;
  price?: number | null;
  currency?: string;
  isFree?: boolean;
  workingHoursStart?: string;
  workingHoursEnd?: string;
  availabilityDays?: string[];
  bookingMethod?: SupportedBookingMethod;
  requiredFields?: string[];
  optionalFields?: string[];
  meetingMode?: MeetingLinkMode;
  meetingLink?: string | null;
  calendarId?: string;
  timezone?: string;
  eventTitleTemplate?: string;
  confirmationTemplate?: string;
  followUpInstructions?: string;
  qualificationQuestions?: string[];
  tags?: ProductTagMapping;
  assignmentRules?: {
    teamName?: string;
    assignedAgentId?: string | null;
    candidateAgentIds?: string[];
  };
  followUpRules?: Record<string, unknown>;
  keywords?: string[];
  // Legacy backward compatibility fields
  productKey?: string;
  tagName?: string;
  ctaType?: 'Demo' | 'Call' | 'Demo/Call' | string;
  teamName?: string;
  assignedAgentId?: string | null;
}

export type ProductActionConfig = TenantProductConfig;

export interface TenantBusinessProfile {
  businessName?: string;
  businessDescription?: string;
  timezone?: string;
  contactPhone?: string;
  contactEmail?: string;
  systemPrompt?: string;
  faqs?: { question: string; answer: string }[];
  policies?: string;
  bookingRules?: string;
  handoffInstructions?: string;
  assignedTeam?: string;
}

export type AiActionEventType =
  | 'AI_PRODUCT_DETECTED'
  | 'TAG_ADDED'
  | 'TAG_REMOVED'
  | 'LEAD_TEMPERATURE_CHANGED'
  | 'LEAD_SCORE_UPDATED'
  | 'NOTE_CREATED'
  | 'LEAD_ASSIGNED'
  | 'CALENDAR_AVAILABILITY_CHECKED'
  | 'APPOINTMENT_BOOKED'
  | 'APPOINTMENT_BOOKING_FAILED'
  | 'HUMAN_HANDOFF_TRIGGERED';

export const APPROVED_PRODUCT_TAGS: Record<string, string> = {
  ABACUS_KIDS: 'ABACUS_KIDS_INTEREST',
  GTC: 'GTC_INTEREST',
  RUBIKS_CUBE: 'RUBIKS_CUBE_INTEREST',
  GOLD: 'GOLD_INTEREST',
  MAA: 'MAA_INTEREST',
  LEAD_PILOT: 'LEAD_PILOT_INTEREST',
};

export const APPROVED_STAGE_TAGS: StageTagName[] = [
  'INTERESTED',
  'DEMO_REQUESTED',
  'DEMO_BOOKED',
  'DEMO_ATTENDED',
  'CALL_REQUESTED',
  'CALL_BOOKED',
  'ENROLLMENT_INTEREST',
  'PURCHASED',
  'HUMAN_HANDOFF',
  'FOLLOW_UP_REQUIRED',
];

export const APPROVED_TEMPERATURE_TAGS: Record<LeadTemperature, TemperatureTagName> = {
  cold: 'COLD_LEAD',
  warm: 'WARM_LEAD',
  hot: 'HOT_LEAD',
};

export const GENIPLUS_SEED_PRODUCTS: Record<string, TenantProductConfig> = {
  ABACUS_KIDS: {
    productServiceId: 'ABACUS_KIDS',
    productKey: 'ABACUS_KIDS',
    name: 'Abacus Mental Math Program',
    description: 'Mental math classes and brain development for children aged 5-14',
    category: 'Kids Program',
    enabled: true,
    tagName: 'ABACUS_KIDS_INTEREST',
    appointmentType: 'Free Abacus Demo',
    durationMinutes: 45, // Confirmed 45m demo
    ctaType: 'Demo',
    teamName: 'Kids/Admissions',
    eventTitleTemplate: '{{name}} - Abacus Demo',
    meetingMode: 'GOOGLE_MEET',
    requiredFields: ['name', 'date', 'time'],
    optionalFields: ['email', 'childAge'],
    tags: {
      interestTag: 'ABACUS_KIDS_INTEREST',
      requestedTag: 'DEMO_REQUESTED',
      bookedTag: 'DEMO_BOOKED',
      purchasedTag: 'PURCHASED',
    },
    keywords: [
      'abacus',
      'mental math',
      'abacus class',
      'abacus for',
      'abacus kids',
      'abacus demo',
      'trial class for my son',
      'trial class for my kid',
      'demo for my son',
      'demo for my kid',
      'demo for my child',
      'demo for my daughter',
      'trial for my son',
    ],
  },
  GTC: {
    productServiceId: 'GTC',
    productKey: 'GTC',
    name: 'Abacus Teacher Training / GTC',
    description: 'Teacher certification and academy startup course',
    category: 'Teacher Training',
    enabled: true,
    tagName: 'GTC_INTEREST',
    appointmentType: 'GTC Training / Business Call',
    durationMinutes: 30,
    ctaType: 'Call',
    teamName: 'Teacher Training/Sales',
    eventTitleTemplate: '{{name}} - GTC Training Call',
    meetingMode: 'NONE',
    requiredFields: ['name', 'date', 'time'],
    optionalFields: ['email'],
    tags: {
      interestTag: 'GTC_INTEREST',
      requestedTag: 'CALL_REQUESTED',
      bookedTag: 'CALL_BOOKED',
      purchasedTag: 'PURCHASED',
    },
    keywords: [
      'abacus teach',
      'teacher training',
      'gtc',
      'start my own abacus',
      'become an abacus teacher',
      'abacus trainer',
      'start teaching abacus',
    ],
  },
  RUBIKS_CUBE: {
    productServiceId: 'RUBIKS_CUBE',
    productKey: 'RUBIKS_CUBE',
    name: "Rubik's Cube Program",
    description: 'Speedcubing and cube solving classes',
    category: 'Kids Program',
    enabled: true,
    tagName: 'RUBIKS_CUBE_INTEREST',
    appointmentType: "Rubik's Cube Demo",
    durationMinutes: 45,
    ctaType: 'Demo',
    teamName: 'Kids Programs',
    eventTitleTemplate: "{{name}} - Rubik's Cube Demo",
    meetingMode: 'GOOGLE_MEET',
    requiredFields: ['name', 'date', 'time'],
    optionalFields: ['email'],
    tags: {
      interestTag: 'RUBIKS_CUBE_INTEREST',
      requestedTag: 'DEMO_REQUESTED',
      bookedTag: 'DEMO_BOOKED',
      purchasedTag: 'PURCHASED',
    },
    keywords: ['rubik', "rubik's cube", 'speedcubing', 'cube class', 'solve cube'],
  },
  GOLD: {
    productServiceId: 'GOLD',
    productKey: 'GOLD',
    name: 'Gold Program',
    description: 'Coaching scaling, leads & sales acceleration for coaching academy owners',
    category: 'Business Coaching',
    enabled: true,
    tagName: 'GOLD_INTEREST',
    appointmentType: 'Gold Business Growth Call',
    durationMinutes: 45,
    ctaType: 'Call',
    teamName: 'Business Growth/Sales',
    eventTitleTemplate: '{{name}} - Business Growth Call',
    meetingMode: 'NONE',
    requiredFields: ['name', 'date', 'time'],
    optionalFields: ['email'],
    tags: {
      interestTag: 'GOLD_INTEREST',
      requestedTag: 'CALL_REQUESTED',
      bookedTag: 'CALL_BOOKED',
      purchasedTag: 'PURCHASED',
    },
    keywords: [
      'grow my coaching',
      'coaching business',
      'gold program',
      'gold interest',
      'more leads and better sales',
    ],
  },
  MAA: {
    productServiceId: 'MAA',
    productKey: 'MAA',
    name: 'MAA — My Abacus Academy',
    description: 'Software for student, fee, attendance, and academy management',
    category: 'Software',
    enabled: true,
    tagName: 'MAA_INTEREST',
    appointmentType: 'MAA Product Demo',
    durationMinutes: 30,
    ctaType: 'Demo',
    teamName: 'Academy Software/Product',
    eventTitleTemplate: '{{name}} - MAA Product Demo',
    meetingMode: 'GOOGLE_MEET',
    requiredFields: ['name', 'date', 'time'],
    optionalFields: ['email'],
    tags: {
      interestTag: 'MAA_INTEREST',
      requestedTag: 'DEMO_REQUESTED',
      bookedTag: 'DEMO_BOOKED',
      purchasedTag: 'PURCHASED',
    },
    keywords: [
      'manage my abacus academy',
      'software to manage',
      'app to manage',
      'academy software',
      'student and fee management',
      'maa',
    ],
  },
  LEAD_PILOT: {
    productServiceId: 'LEAD_PILOT',
    productKey: 'LEAD_PILOT',
    name: 'Lead Pilot',
    description: 'WhatsApp CRM and automated lead conversion system for coaches',
    category: 'Software',
    enabled: true,
    tagName: 'LEAD_PILOT_INTEREST',
    appointmentType: 'Lead Pilot Demo / Call',
    durationMinutes: 30,
    ctaType: 'Demo/Call',
    teamName: 'SaaS/Sales',
    eventTitleTemplate: '{{name}} - Lead Pilot Demo',
    meetingMode: 'GOOGLE_MEET',
    requiredFields: ['name', 'date', 'time'],
    optionalFields: ['email'],
    tags: {
      interestTag: 'LEAD_PILOT_INTEREST',
      requestedTag: 'DEMO_REQUESTED',
      bookedTag: 'DEMO_BOOKED',
      purchasedTag: 'PURCHASED',
    },
    keywords: [
      'whatsapp automation',
      'automation for my leads',
      'lead pilot',
      'leadpilot',
      'whatsapp crm',
      'leads automation',
    ],
  },
};

export const DEFAULT_PRODUCT_CONFIGS: Record<string, TenantProductConfig> = GENIPLUS_SEED_PRODUCTS;

export type ScoringSignal =
  | 'product_identified'
  | 'asks_pricing'
  | 'asks_enrollment'
  | 'requests_demo_or_call'
  | 'books_demo_or_call'
  | 'asks_payment'
  | 'confirms_appointment'
  | 'ready_to_join';

export const DEFAULT_SCORING_WEIGHTS: Record<ScoringSignal, number> = {
  product_identified: 10,
  asks_pricing: 10,
  asks_enrollment: 15,
  requests_demo_or_call: 20,
  books_demo_or_call: 25,
  asks_payment: 25,
  confirms_appointment: 20,
  ready_to_join: 20,
};

export interface DetectedIntents {
  products: ProductKey[];
  matchingConfigs?: TenantProductConfig[];
  isAmbiguousProduct?: boolean;
  clarifyingQuestion?: string;
  stageTagsToAdd: StageTagName[];
  signals: ScoringSignal[];
  temperature?: LeadTemperature;
  customerName?: string | null;
  explicitNameProvided?: boolean;
  requestedDateText?: string | null;
  requestedTimeText?: string | null;
  email?: string | null;
  noEmailExplicitlyStated?: boolean;
  childAge?: number | null;
  childName?: string | null;
  parentName?: string | null;
  customerType?: string;
  painPoint?: string;
  isHumanHandoffRequested: boolean;
  isReadyToBook: boolean;
  hasBothDateAndTime: boolean;
  hasOnlyDate: boolean;
  hasOnlyTime: boolean;
  isSlotCheckOrReschedule?: boolean;
}

export interface AvailableSlotItem {
  startTime: string; // ISO
  endTime: string;   // ISO
  humanText: string;
}

export interface CalendarActionResult {
  action: 'check_availability' | 'get_available_slots' | 'book_appointment';
  success: boolean;
  available?: boolean;
  booked?: boolean;
  bookingId?: string;
  meetLink?: string | null;
  slots?: AvailableSlotItem[];
  error?: string;
}

export interface ActionPipelineResult {
  customerResponse: string;
  productKey?: ProductKey;
  tagsAdded: string[];
  tagsRemoved: string[];
  leadTemperature?: LeadTemperature;
  leadScore: number;
  assignedAgentId?: string | null;
  crmNoteCreated?: string;
  calendarResult?: CalendarActionResult;
  isHandoff: boolean;
}
