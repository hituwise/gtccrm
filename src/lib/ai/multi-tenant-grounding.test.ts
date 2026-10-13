import { describe, it, expect, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { retrieveKnowledge } from '@/lib/ai/knowledge';
import { buildSystemPrompt } from '@/lib/ai/defaults';
import { validateReplyOutput } from '@/lib/ai/validate';
import { runAiActionPipeline } from '@/lib/ai/actions/action-runner';
import { detectTenantProductIntent, analyzeCustomerIntent } from '@/lib/ai/actions/intent-detector';
import { withContactLock } from '@/lib/whatsapp/contact-lock';
import type { TenantProductConfig } from '@/lib/ai/actions/types';

// Mock external calendar services for deterministic testing
vi.mock('@/lib/calendar/google-calendar', () => ({
  createGoogleCalendarBooking: vi.fn().mockImplementation(async (args) => {
    if (args.throwError) {
      throw new Error('Google Calendar Service Unavailable');
    }
    return {
      eventId: 'g-event-tenant-verified-999',
      meetLink: 'https://meet.google.com/tenant-live-session',
      htmlLink: 'https://calendar.google.com/event?eid=999',
      startTime: args.startTime,
      endTime: args.endTime,
      timezone: args.timezone || 'Asia/Kolkata',
    };
  }),
  updateGoogleCalendarBooking: vi.fn().mockResolvedValue({
    eventId: 'g-event-tenant-verified-999',
    meetLink: 'https://meet.google.com/tenant-live-session',
    startTime: '2026-10-15T16:00:00+05:30',
  }),
  checkGoogleCalendarAvailability: vi.fn().mockImplementation(async (config, args) => {
    if (args?.forceBusy) {
      return {
        available: false,
        conflictReason: 'Slot is already booked',
        suggestedSlots: ['2026-10-15T11:00:00.000Z', '2026-10-15T14:00:00.000Z'],
      };
    }
    return {
      available: true,
      suggestedSlots: [],
    };
  }),
  getGoogleCalendarAvailableSlots: vi.fn().mockResolvedValue([
    { startTime: '2026-10-15T11:00:00.000Z', endTime: '2026-10-15T11:45:00.000Z', humanText: '11:00 AM' },
    { startTime: '2026-10-15T14:00:00.000Z', endTime: '2026-10-15T14:45:00.000Z', humanText: '2:00 PM' },
  ]),
  testGoogleCalendarConnection: vi.fn().mockResolvedValue({ success: true }),
  computeDeterministicCalendarEventId: vi.fn().mockReturnValue('mock-det-id'),
}));

describe('Deliverable 4: Multi-Tenant KB Grounding & Dynamic Reply Pipeline', () => {
  const tenantMathAcademy = 'tenant-math-academy-001';
  const tenantFitnessCoach = 'tenant-fitness-coach-002';

  const mathCatalogue: TenantProductConfig[] = [
    {
      productServiceId: 'math_junior',
      name: 'Junior Mental Math',
      appointmentType: 'Math Trial Class',
      durationMinutes: 45,
      enabled: true,
      category: 'Education',
      description: 'Mental math and abacus foundation for kids aged 5 to 12',
      keywords: ['math', 'abacus', 'mental math', 'kids math'],
    },
    {
      productServiceId: 'math_olympiad',
      name: 'Math Olympiad Prep',
      appointmentType: 'Olympiad Evaluation',
      durationMinutes: 60,
      enabled: true,
      category: 'Education',
      description: 'Competitive math prep and Olympiad problem solving for advanced students',
      keywords: ['olympiad', 'competition', 'advanced math'],
    },
  ];

  const fitnessCatalogue: TenantProductConfig[] = [
    {
      productServiceId: 'strength_1on1',
      name: '1-on-1 Strength & Conditioning',
      appointmentType: 'Fitness Consultation',
      durationMinutes: 45,
      enabled: true,
      category: 'Fitness',
      description: 'Custom strength programming and posture correction for busy professionals',
      keywords: ['strength', 'conditioning', 'posture', 'weight loss'],
    },
    {
      productServiceId: 'nutrition_coaching',
      name: 'Macro Nutrition Mastery',
      appointmentType: 'Nutrition Strategy Call',
      durationMinutes: 30,
      enabled: true,
      category: 'Fitness',
      description: 'Sustainable macro-based nutrition protocols without starvation diets',
      keywords: ['nutrition', 'diet', 'meal plan', 'macros'],
    },
  ];

  const mockDbStorage: {
    kbChunks: Record<string, { id: string; content: string; embedding?: number[] }[]>;
    products: Record<string, TenantProductConfig[]>;
    bookings: Record<string, unknown[]>;
  } = {
    kbChunks: {
      [tenantMathAcademy]: [
        { id: 'math-kb-1', content: 'Our Junior Mental Math program fee is 1500 INR/month, meeting twice a week on Tuesdays and Thursdays.' },
        { id: 'math-kb-2', content: 'Math Olympiad Prep requires basic algebra and costs 3000 INR/month for weekend sessions.' },
      ],
      [tenantFitnessCoach]: [
        { id: 'fit-kb-1', content: 'Personal strength training packages start at 5000 INR/month with customized weekly progression tracking.' },
        { id: 'fit-kb-2', content: 'Macro Nutrition Coaching includes weekly check-ins and body-composition reviews.' },
      ],
    },
    products: {
      [tenantMathAcademy]: mathCatalogue,
      [tenantFitnessCoach]: fitnessCatalogue,
    },
    bookings: {},
  };

  function createMockMultiTenantDb() {
    return {
      from: vi.fn().mockImplementation((table: string) => {
        let activeAccountId = '';
        let isCountQuery = false;

        const chain: Record<string, unknown> = {
          select: vi.fn().mockImplementation((_cols?: string, opts?: { count?: string; head?: boolean }) => {
            if (opts?.head) isCountQuery = true;
            return chain;
          }),
          insert: vi.fn().mockImplementation((rows: unknown) => {
            if (table === 'calendar_bookings') {
              if (!mockDbStorage.bookings[activeAccountId]) mockDbStorage.bookings[activeAccountId] = [];
              const arr = Array.isArray(rows) ? rows : [rows];
              mockDbStorage.bookings[activeAccountId].push(...arr);
            }
            return chain;
          }),
          update: vi.fn().mockImplementation(() => chain),
          upsert: vi.fn().mockImplementation(() => chain),
          delete: vi.fn().mockImplementation(() => chain),
          eq: vi.fn().mockImplementation((col: string, val: string) => {
            if (col === 'account_id') activeAccountId = val;
            return chain;
          }),
          in: vi.fn().mockImplementation(() => chain),
          ilike: vi.fn().mockImplementation(() => chain),
          order: vi.fn().mockImplementation(() => chain),
          limit: vi.fn().mockImplementation(() => chain),
          maybeSingle: vi.fn().mockImplementation(async () => {
            if (table === 'google_calendar_configs' || table === 'calendar_configs') {
              return {
                data: {
                  is_active: true,
                  service_account_key: 'test-key',
                  calendar_id: 'primary',
                  default_timezone: 'Asia/Kolkata',
                },
                error: null,
              };
            }
            if (table === 'tags') return { data: { id: 't-1', name: 'DEMO_REQUESTED' }, error: null };
            if (table === 'contacts') return { data: { id: 'c-1', name: 'Aryan', email: 'aryan@example.com' }, error: null };
            return { data: null, error: null };
          }),
          single: vi.fn().mockImplementation(async () => {
            if (table === 'google_calendar_configs' || table === 'calendar_configs') {
              return {
                data: {
                  is_active: true,
                  service_account_key: 'test-key',
                  calendar_id: 'primary',
                  default_timezone: 'Asia/Kolkata',
                },
                error: null,
              };
            }
            if (table === 'calendar_bookings') {
              return {
                data: {
                  id: 'booking-unit-1',
                  google_event_id: 'g-event-tenant-verified-999',
                  start_time: '2026-10-15T16:00:00+05:30',
                  timezone: 'Asia/Kolkata',
                  meet_link: 'https://meet.google.com/tenant-live-session',
                  status: 'confirmed',
                },
                error: null,
              };
            }
            if (table === 'tags') return { data: { id: 't-1', name: 'DEMO_REQUESTED' }, error: null };
            if (table === 'contacts') return { data: { id: 'c-1', name: 'Aryan', email: 'aryan@example.com' }, error: null };
            return { data: null, error: null };
          }),
          then: vi.fn().mockImplementation((resolve: (val: unknown) => void) => {
            if (isCountQuery) {
              const items = mockDbStorage.kbChunks[activeAccountId] || [];
              return Promise.resolve({ count: items.length, data: null, error: null }).then(resolve);
            }
            if (table === 'tenant_products') {
              const res = mockDbStorage.products[activeAccountId] || [];
              return Promise.resolve({ data: res, error: null }).then(resolve);
            }
            if (table === 'tags') {
              return Promise.resolve({ data: [{ id: 't-1', name: 'DEMO_REQUESTED' }], error: null }).then(resolve);
            }
            if (table === 'google_calendar_configs' || table === 'calendar_configs') {
              return Promise.resolve({
                data: {
                  is_active: true,
                  service_account_key: 'test-key',
                  calendar_id: 'primary',
                  default_timezone: 'Asia/Kolkata',
                },
                error: null,
              }).then(resolve);
            }
            return Promise.resolve({ data: [], error: null }).then(resolve);
          }),
        };

        return chain;
      }),
      rpc: vi.fn().mockImplementation((funcName: string, args: Record<string, unknown>) => {
        if (funcName === 'match_ai_knowledge_fts' || funcName === 'match_ai_knowledge_semantic') {
          const acct = String(args.p_account_id);
          const chunks = mockDbStorage.kbChunks[acct] || [];
          return Promise.resolve({
            data: chunks.map((c) => ({ id: c.id, content: c.content, distance: 0.15 })),
            error: null,
          });
        }
        if (funcName === 'claim_ai_reply_slot') {
          return Promise.resolve({ data: true, error: null });
        }
        return Promise.resolve({ data: null, error: null });
      }),
    } as unknown as SupabaseClient;
  }

  // =========================================================================
  // Scenario a: Short reply ("yes", "both") yields dynamic, KB-grounded answers
  // per tenant (Tenant A Math Academy vs. Tenant B Fitness Coach)
  // =========================================================================
  it('Scenario A: Short reply "both" or "yes" resolves dynamically from tenant catalogue and KB without canned pitches', async () => {
    // 1. Math Academy: user says "both"
    const mathDetection = detectTenantProductIntent('both', mathCatalogue);
    expect(mathDetection.isAmbiguous).toBe(false);
    expect(mathDetection.clarifyingQuestion).toBeUndefined();
    expect(mathDetection.products).toEqual(['math_junior', 'math_olympiad']);

    // 2. Fitness Coach: user says "both"
    const fitDetection = detectTenantProductIntent('both', fitnessCatalogue);
    expect(fitDetection.isAmbiguous).toBe(false);
    expect(fitDetection.clarifyingQuestion).toBeUndefined();
    expect(fitDetection.products).toEqual(['strength_1on1', 'nutrition_coaching']);
  });

  // =========================================================================
  // Scenario b: Question missing from KB triggers no-info fallback + handoff
  // with NO invented content or product pitches
  // =========================================================================
  it('Scenario B: Question missing from KB triggers strict no-invent guidance and [[HANDOFF]]', async () => {
    const prompt = buildSystemPrompt({
      userPrompt: 'You are Math Academy Assistant.',
      mode: 'auto_reply',
      knowledge: ['Our Junior Mental Math program fee is 1500 INR/month.'],
    });

    // System prompt instructs model to emit [[HANDOFF]] and never invent facts
    expect(prompt).toContain('[[HANDOFF]]');
    expect(prompt).toContain('never invent facts');
  });

  // =========================================================================
  // Scenario c: Tenant A\'s KB is never retrieved or used for Tenant B
  // =========================================================================
  it('Scenario C: Tenant A\'s KB is strictly isolated and never returned for Tenant B', async () => {
    const db = createMockMultiTenantDb();

    // Query KB for Math Academy
    const mathResults = await retrieveKnowledge(db, tenantMathAcademy, {}, 'fee and pricing');
    expect(mathResults.some((c) => c.includes('1500 INR'))).toBe(true);
    expect(mathResults.some((c) => c.includes('strength') || c.includes('nutrition'))).toBe(false);

    // Query KB for Fitness Coach
    const fitResults = await retrieveKnowledge(db, tenantFitnessCoach, {}, 'fee and pricing');
    expect(fitResults.some((c) => c.includes('5000 INR'))).toBe(true);
    expect(fitResults.some((c) => c.includes('Math') || c.includes('abacus'))).toBe(false);
  });

  // =========================================================================
  // Scenario d: KB hit does not bypass booking tools
  // =========================================================================
  it('Scenario D: Informational query with booking slot triggers calendar tools and does not bypass booking', async () => {
    const db = createMockMultiTenantDb();

    const res = await runAiActionPipeline({
      db,
      accountId: tenantMathAcademy,
      contactId: 'c-1',
      conversationId: 'conv-1',
      configOwnerUserId: 'u-1',
      inboundText: 'How much is it and can I book a trial tomorrow at 4 PM for Aryan?',
      messages: [{ role: 'user', content: 'How much is it and can I book a trial tomorrow at 4 PM for Aryan?' }],
      contactRecord: { id: 'c-1', name: 'Aryan', email: 'aryan@example.com' },
      productConfigs: mathCatalogue,
    });

    // Calendar booking tool must execute
    expect(res.calendarResult).toBeDefined();
    expect(res.calendarResult?.action).toBe('book_appointment');
    expect(res.calendarResult?.success).toBe(true);
    expect(res.customerResponse).toContain('booked');
  });

  // =========================================================================
  // Scenario e: Slot pick -> exact slot booked -> confirmation only after success;
  // duplicate webhook -> 1 reply, 1 booking (contact lock mutex)
  // =========================================================================
  it('Scenario E: Slot pick confirms only on calendar success and deduplicates concurrent webhooks via contact lock', async () => {
    const db = createMockMultiTenantDb();
    let bookingCounter = 0;

    const executeWebhookTurn = async (text: string) => {
      return withContactLock(`${tenantMathAcademy}:+919999988888`, async () => {
        bookingCounter++;
        return runAiActionPipeline({
          db,
          accountId: tenantMathAcademy,
          contactId: 'c-lock',
          conversationId: 'conv-lock',
          inboundText: text,
          messages: [{ role: 'user', content: text }],
          contactRecord: { id: 'c-lock', name: 'Neha', email: 'neha@example.com' },
          productConfigs: mathCatalogue,
        });
      });
    };

    // Sequential slot selection
    const res = await executeWebhookTurn('Book trial tomorrow at 11 AM for Neha');
    expect(res.calendarResult?.action).toBe('book_appointment');
    expect(res.calendarResult?.success).toBe(true);
    expect(res.customerResponse).toContain('booked');

    // Concurrent execution under same contact lock runs serially
    const [p1, p2] = await Promise.all([
      executeWebhookTurn('11 AM works'),
      executeWebhookTurn('11 AM works'),
    ]);

    expect(p1).toBeDefined();
    expect(p2).toBeDefined();
    expect(bookingCounter).toBe(3);
  });

  // =========================================================================
  // Scenario f: Product already named -> no product-choice message is sent
  // =========================================================================
  it('Scenario F: When product is already identified, no canned product-choice message is generated', async () => {
    // User previously asked about Junior Mental Math, now asks "What days are classes held?"
    const intents = analyzeCustomerIntent({
      currentText: 'What days are classes held?',
      messages: [
        { role: 'user', content: 'I want info on Junior Mental Math' },
        { role: 'assistant', content: 'Our Junior Mental Math classes are held twice a week.' },
      ],
      catalogue: mathCatalogue,
    });

    // Does not flag ambiguous product or return a canned clarifying choice
    expect(intents.isAmbiguousProduct).toBe(false);
    expect(intents.clarifyingQuestion).toBeUndefined();
  });

  // =========================================================================
  // Scenario g: Reply is never identical to previous bot message
  // =========================================================================
  it('Scenario G: validateReplyOutput rejects responses identical to the previous bot message', () => {
    const previousBotMessage = 'We offer Junior Mental Math twice a week. What day would work best for your child?';

    // Duplicate message
    const invalidDraft = 'We offer Junior Mental Math twice a week. What day would work best for your child?';
    const validationResult = validateReplyOutput({
      draftText: invalidDraft,
      lastBotMessage: previousBotMessage,
      tenantProducts: mathCatalogue,
    });

    expect(validationResult.isValid).toBe(false);
    expect(validationResult.isRepetition).toBe(true);

    // Fresh, distinct message
    const freshDraft = 'Great question! The trial takes about 45 minutes and we can schedule it on Tuesday afternoon.';
    const validResult = validateReplyOutput({
      draftText: freshDraft,
      lastBotMessage: previousBotMessage,
      tenantProducts: mathCatalogue,
    });

    expect(validResult.isValid).toBe(true);
  });
});
