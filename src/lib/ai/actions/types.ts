// ============================================================
// AI Agent Action System Types
// ============================================================

export type ProductKey =
  | 'ABACUS_KIDS'
  | 'GTC'
  | 'RUBIKS_CUBE'
  | 'GOLD'
  | 'MAA'
  | 'LEAD_PILOT';

export type ProductTagName =
  | 'ABACUS_KIDS_INTEREST'
  | 'GTC_INTEREST'
  | 'RUBIKS_CUBE_INTEREST'
  | 'GOLD_INTEREST'
  | 'MAA_INTEREST'
  | 'LEAD_PILOT_INTEREST';

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

export interface ProductActionConfig {
  productKey: ProductKey;
  tagName: ProductTagName;
  appointmentType: string;
  durationMinutes: number;
  ctaType: 'Demo' | 'Call' | 'Demo/Call';
  teamName: string;
  assignedAgentId?: string | null;
}

export const APPROVED_PRODUCT_TAGS: Record<ProductKey, ProductTagName> = {
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

export const DEFAULT_PRODUCT_CONFIGS: Record<ProductKey, ProductActionConfig> = {
  ABACUS_KIDS: {
    productKey: 'ABACUS_KIDS',
    tagName: 'ABACUS_KIDS_INTEREST',
    appointmentType: 'Free Abacus Demo',
    durationMinutes: 45, // Confirmed 45m demo
    ctaType: 'Demo',
    teamName: 'Kids/Admissions',
  },
  GTC: {
    productKey: 'GTC',
    tagName: 'GTC_INTEREST',
    appointmentType: 'Teacher Training Call',
    durationMinutes: 30,
    ctaType: 'Call',
    teamName: 'Teacher Training/Sales',
  },
  RUBIKS_CUBE: {
    productKey: 'RUBIKS_CUBE',
    tagName: 'RUBIKS_CUBE_INTEREST',
    appointmentType: "Rubik's Cube Demo",
    durationMinutes: 45,
    ctaType: 'Demo',
    teamName: 'Kids Programs',
  },
  GOLD: {
    productKey: 'GOLD',
    tagName: 'GOLD_INTEREST',
    appointmentType: 'Business Growth Call',
    durationMinutes: 45,
    ctaType: 'Call',
    teamName: 'Business Growth/Sales',
  },
  MAA: {
    productKey: 'MAA',
    tagName: 'MAA_INTEREST',
    appointmentType: 'MAA Product Demo',
    durationMinutes: 30,
    ctaType: 'Demo',
    teamName: 'Academy Software/Product',
  },
  LEAD_PILOT: {
    productKey: 'LEAD_PILOT',
    tagName: 'LEAD_PILOT_INTEREST',
    appointmentType: 'Lead Pilot Demo/Call',
    durationMinutes: 30,
    ctaType: 'Demo/Call',
    teamName: 'SaaS/Sales',
  },
};

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
  stageTagsToAdd: StageTagName[];
  signals: ScoringSignal[];
  temperature?: LeadTemperature;
  requestedDateText?: string | null;
  requestedTimeText?: string | null;
  email?: string | null;
  childAge?: number | null;
  customerType?: string;
  painPoint?: string;
  isHumanHandoffRequested: boolean;
  isReadyToBook: boolean;
  hasBothDateAndTime: boolean;
  hasOnlyDate: boolean;
  hasOnlyTime: boolean;
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
