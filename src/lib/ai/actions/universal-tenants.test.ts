import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { runAiActionPipeline } from './action-runner';
import {
  detectTenantProductIntent,
  analyzeCustomerIntent,
} from './intent-detector';
import {
  getTenantProducts,
  getTenantProductById,
  upsertTenantProduct,
} from '@/lib/products/tenant-products';
import { executeDemoBooking } from '@/lib/calendar/booking-coordinator';
import {
  GENIPLUS_SEED_PRODUCTS,
  DEFAULT_PRODUCT_CONFIGS,
  type TenantProductConfig,
} from './types';

// Mock external calendar services so tests run in deterministic isolation
vi.mock('@/lib/calendar/google-calendar', () => ({
  createGoogleCalendarBooking: vi.fn().mockImplementation(async (args) => {
    if (args.throwError) {
      throw new Error('Google Calendar Service Unavailable');
    }
    return {
      eventId: 'g-event-tenant-verified-123',
      meetLink: 'https://meet.google.com/tenant-abc-xyz',
      htmlLink: 'https://calendar.google.com/event?eid=123',
      startTime: args.startTime,
      endTime: args.endTime,
      timezone: args.timezone || 'Asia/Kolkata',
    };
  }),
  updateGoogleCalendarBooking: vi.fn().mockResolvedValue({
    eventId: 'g-event-tenant-verified-123',
    meetLink: 'https://meet.google.com/tenant-abc-xyz',
    htmlLink: 'https://calendar.google.com/event?eid=123',
    startTime: '2026-10-09T17:00:00+05:30',
    endTime: '2026-10-09T17:45:00+05:30',
    title: 'Appointment: Rescheduled',
  }),
  checkGoogleCalendarAvailability: vi.fn().mockImplementation(async (config, args) => {
    if (args?.forceBusy) {
      return {
        available: false,
        conflictReason: 'Time slot overlaps with existing event',
        suggestedSlots: ['2026-10-10T12:00:00.000Z', '2026-10-10T13:00:00.000Z'],
      };
    }
    return {
      available: true,
      suggestedSlots: [],
    };
  }),
  getGoogleCalendarAvailableSlots: vi.fn().mockResolvedValue([
    { startTime: '2026-10-10T11:00:00.000Z', endTime: '2026-10-10T11:45:00.000Z', humanText: '11:00 AM' },
    { startTime: '2026-10-10T14:00:00.000Z', endTime: '2026-10-10T14:45:00.000Z', humanText: '2:00 PM' },
  ]),
  testGoogleCalendarConnection: vi.fn().mockResolvedValue({ success: true, email: 'sa@tenant.iam.gserviceaccount.com' }),
}));

// Mock WhatsApp message dispatch
vi.mock('@/lib/whatsapp/send', () => ({
  sendWhatsAppMessage: vi.fn().mockResolvedValue({ success: true, messageId: 'wa-msg-123' }),
}));

describe('Lead Pilot — Multi-Tenant Universal Product & Booking Architecture', () => {
  const geniplusAccountId = 'geniplus-tenant-acc';
  const coachAccountId = 'bizcoach-tenant-acc';
  const fitnessAccountId = 'fitcoach-tenant-acc';

  const mockDbData: {
    tenantProducts: Record<string, TenantProductConfig[]>;
    bookings: Record<string, unknown[]>;
  } = {
    tenantProducts: {},
    bookings: {},
  };

  function createMockDb(currentAccountId: string) {
    return {
      from: vi.fn().mockImplementation((table: string) => {
        let currentFilterAccountId = currentAccountId;

        function createChain(data: unknown) {
          type Chain = {
            select: () => Chain;
            insert: (val: unknown) => Chain;
            update: (val: unknown) => Chain;
            upsert: (val: unknown) => Chain;
            delete: () => Chain;
            eq: (col: string, val: string) => Chain;
            in: () => Chain;
            ilike: () => Chain;
            order: () => Chain;
            limit: () => Chain;
            single: () => Promise<{ data: unknown; error: null }>;
            maybeSingle: () => Promise<{ data: unknown; error: null }>;
            then: <T1 = { data: unknown; error: null }, T2 = never>(
              res?: ((v: { data: unknown; error: null }) => T1 | PromiseLike<T1>) | null,
            ) => Promise<T1 | T2>;
          };

          const chain: Chain = {
            select: () => chain,
            insert: (val: unknown) => {
              if (table === 'calendar_bookings') {
                const list = mockDbData.bookings[currentFilterAccountId] || [];
                list.push(val);
                mockDbData.bookings[currentFilterAccountId] = list;
              }
              return chain;
            },
            update: () => chain,
            upsert: (val: unknown) => {
              if (table === 'tenant_products') {
                const p = val as TenantProductConfig;
                const list = mockDbData.tenantProducts[currentFilterAccountId] || [];
                const idx = list.findIndex(
                  (item) => item.productServiceId === (p.productServiceId || p.productKey),
                );
                if (idx >= 0) list[idx] = p;
                else list.push(p);
                mockDbData.tenantProducts[currentFilterAccountId] = list;
              }
              return chain;
            },
            delete: () => chain,
            eq: (col: string, val: string) => {
              if (col === 'account_id') currentFilterAccountId = val;
              return chain;
            },
            in: () => chain,
            ilike: () => chain,
            order: () => chain,
            limit: () => chain,
            single: () => Promise.resolve({ data, error: null }),
            maybeSingle: () => {
              if (table === 'tenant_products') {
                const list = mockDbData.tenantProducts[currentFilterAccountId] || [];
                return Promise.resolve({ data: list[0] || null, error: null });
              }
              return Promise.resolve({ data, error: null });
            },
            then: (resolve) => {
              if (table === 'tenant_products') {
                const list = mockDbData.tenantProducts[currentFilterAccountId] || [];
                return Promise.resolve({ data: list, error: null }).then(resolve);
              }
              return Promise.resolve({ data, error: null }).then(resolve);
            },
          };
          return chain;
        }

        if (table === 'tenant_products') {
          const list = mockDbData.tenantProducts[currentFilterAccountId] || [];
          return createChain(list);
        }
        if (table === 'tags') {
          return createChain({ id: 'tag-1', name: 'APPROVED_TAG' });
        }
        if (table === 'contacts') {
          return createChain({
            id: 'contact-test',
            name: 'Priya Sharma',
            email: 'priya@example.com',
            phone: '+919876543210',
            lead_score: 10,
            lead_temperature: 'warm',
          });
        }
        if (table === 'google_calendar_configs') {
          return createChain({
            is_active: true,
            service_account_key: 'test-key',
            calendar_id: 'primary',
            default_timezone: 'Asia/Kolkata',
            default_meeting_duration: 45,
          });
        }
        if (table === 'calendar_bookings') {
          const defaultCreatedBooking = {
            id: 'booking-unit-1',
            google_event_id: 'g-event-tenant-verified-123',
            start_time: '2026-10-10T10:00:00.000Z',
            timezone: 'Asia/Kolkata',
            meet_link: 'https://meet.google.com/tenant-abc-xyz',
            status: 'confirmed',
          };
          let lastInserted: any = null;
          const chain: any = {
            select: () => chain,
            insert: (val: any) => {
              lastInserted = val;
              const list = mockDbData.bookings[currentFilterAccountId] || [];
              list.push(val);
              mockDbData.bookings[currentFilterAccountId] = list;
              return chain;
            },
            update: () => chain,
            delete: () => chain,
            eq: () => chain,
            in: () => chain,
            ilike: () => chain,
            order: () => chain,
            limit: () => chain,
            single: () => Promise.resolve({ data: lastInserted ? { ...defaultCreatedBooking, ...lastInserted } : defaultCreatedBooking, error: null }),
            maybeSingle: () => Promise.resolve({ data: null, error: null }),
            then: (resolve: any) => Promise.resolve({ data: lastInserted ? { ...defaultCreatedBooking, ...lastInserted } : defaultCreatedBooking, error: null }).then(resolve),
          };
          return chain;
        }
        if (table === 'ai_configs') {
          return createChain({
            action_system_enabled: true,
            product_configs: {},
          });
        }
        if (table === 'accounts') {
          const isGeniplus = currentFilterAccountId === geniplusAccountId;
          return createChain({
            id: currentFilterAccountId,
            name: isGeniplus ? 'Geniplus Edutech' : 'Universal Tenant Account',
          });
        }
        return createChain({ id: 'dummy-id' });
      }),
      rpc: vi.fn().mockResolvedValue({ data: null, error: null }),
    };
  }

  // Pre-seed tenant catalogues
  const coachService: TenantProductConfig = {
    productServiceId: 'biz_scaling_audit',
    productKey: 'biz_scaling_audit',
    tenantId: coachAccountId,
    name: 'Business Strategy Audit',
    category: 'Business Coaching',
    description: '1-on-1 strategy audit for entrepreneurs and coaches wanting to scale revenue',
    enabled: true,
    appointmentType: 'Strategy Audit Call',
    durationMinutes: 60,
    meetingMode: 'ZOOM',
    meetingLink: 'https://zoom.us/j/coach999888',
    requiredFields: ['name'],
    optionalFields: ['email', 'phone'],
    tags: {
      interestTag: 'COACH_AUDIT_INTEREST',
      bookedTag: 'COACH_AUDIT_BOOKED',
    },
    ctaType: 'Call',
    teamName: 'Coaching Operations',
  };

  const fitnessService: TenantProductConfig = {
    productServiceId: 'personal_training_trial',
    productKey: 'personal_training_trial',
    tenantId: fitnessAccountId,
    name: 'Personal Training Assessment',
    category: 'Fitness & Health',
    description: '1-on-1 personalized fitness assessment and custom workout plan',
    enabled: true,
    appointmentType: '1-on-1 Fitness Assessment',
    durationMinutes: 45,
    meetingMode: 'STATIC_MEETING_LINK',
    meetingLink: 'https://meet.fitcoach.io/alex-session',
    requiredFields: ['name'],
    optionalFields: ['email', 'phone'],
    tags: {
      interestTag: 'FITNESS_TRIAL_INTEREST',
      bookedTag: 'FITNESS_TRIAL_BOOKED',
    },
    ctaType: 'Call',
    teamName: 'Personal Trainers',
  };

  beforeEach(() => {
    vi.restoreAllMocks();
    vi.clearAllMocks();
    mockDbData.tenantProducts = {
      [geniplusAccountId]: Object.values(GENIPLUS_SEED_PRODUCTS),
      [coachAccountId]: [coachService],
      [fitnessAccountId]: [fitnessService],
    };
    mockDbData.bookings = {};
  });

  // CRITERION 1: Geniplus tenant correctly identifies and books an Abacus demo
  it('Criterion 1: Geniplus tenant correctly identifies and books an Abacus demo', async () => {
    const db = createMockDb(geniplusAccountId) as unknown as SupabaseClient;
    const res = await runAiActionPipeline({
      db,
      accountId: geniplusAccountId,
      contactId: 'contact-abacus-1',
      conversationId: 'conv-abacus-1',
      inboundText: 'I want Abacus classes for my child. Tomorrow at 5 PM. Name is Rajesh.',
      messages: [{ role: 'user', content: 'I want Abacus classes for my child. Tomorrow at 5 PM. Name is Rajesh.' }],
      contactRecord: { id: 'contact-abacus-1', name: 'Rajesh', email: 'rajesh@example.com' },
    });

    expect(res.productKey).toBe('ABACUS_KIDS');
    expect(res.tagsAdded).toContain('ABACUS_KIDS_INTEREST');
    expect(res.tagsAdded).toContain('DEMO_BOOKED');
    expect(res.customerResponse).toContain('Abacus demo is booked');
    expect(res.customerResponse).toContain('Google Meet');
  });

  // CRITERION 2: Business coach tenant identifies and books its own consultation service
  it('Criterion 2: Business coach tenant identifies and books its own consultation service', async () => {
    const db = createMockDb(coachAccountId) as unknown as SupabaseClient;
    const res = await runAiActionPipeline({
      db,
      accountId: coachAccountId,
      contactId: 'contact-coach-1',
      conversationId: 'conv-coach-1',
      inboundText: 'I want help getting more clients and scaling my business revenue. Tomorrow at 4 PM. My name is Priya.',
      messages: [{ role: 'user', content: 'I want help getting more clients and scaling my business revenue. Tomorrow at 4 PM. My name is Priya.' }],
      contactRecord: { id: 'contact-coach-1', name: 'Priya', email: 'priya@coachee.com' },
    });

    expect(res.productKey).toBe('biz_scaling_audit');
    expect(res.tagsAdded).toContain('COACH_AUDIT_INTEREST');
    expect(res.tagsAdded).toContain('COACH_AUDIT_BOOKED');
    expect(res.customerResponse).toContain('Strategy Audit Call');
    expect(res.customerResponse).toContain('https://zoom.us/j/coach999888');
    expect(res.customerResponse).not.toContain('Abacus');
  });

  // CRITERION 3: Fitness trainer tenant identifies and books its own service
  it('Criterion 3: Fitness trainer tenant identifies and books its own service', async () => {
    const db = createMockDb(fitnessAccountId) as unknown as SupabaseClient;
    const res = await runAiActionPipeline({
      db,
      accountId: fitnessAccountId,
      contactId: 'contact-fit-1',
      conversationId: 'conv-fit-1',
      inboundText: 'I want personal training to get back into shape and build muscle. Tomorrow at 10 AM, name is Alex.',
      messages: [{ role: 'user', content: 'I want personal training to get back into shape and build muscle. Tomorrow at 10 AM, name is Alex.' }],
      contactRecord: { id: 'contact-fit-1', name: 'Alex', email: 'alex@fit.com' },
    });

    expect(res.productKey).toBe('personal_training_trial');
    expect(res.tagsAdded).toContain('FITNESS_TRIAL_INTEREST');
    expect(res.tagsAdded).toContain('FITNESS_TRIAL_BOOKED');
    expect(res.customerResponse).toContain('1-on-1 Fitness Assessment');
    expect(res.customerResponse).toContain('https://meet.fitcoach.io/alex-session');
    expect(res.customerResponse).not.toContain('Abacus');
  });

  // CRITERION 4: Each tenant receives only its own configured meeting link
  it('Criterion 4: Each tenant receives only its own configured meeting link and never leaks another tenant link', async () => {
    const dbCoach = createMockDb(coachAccountId) as unknown as SupabaseClient;
    const coachProducts = await getTenantProducts(dbCoach, coachAccountId);
    expect(coachProducts[0].meetingLink).toBe('https://zoom.us/j/coach999888');
    expect(coachProducts[0].meetingLink).not.toContain('fitcoach.io');

    const dbFitness = createMockDb(fitnessAccountId) as unknown as SupabaseClient;
    const fitnessProducts = await getTenantProducts(dbFitness, fitnessAccountId);
    expect(fitnessProducts[0].meetingLink).toBe('https://meet.fitcoach.io/alex-session');
    expect(fitnessProducts[0].meetingLink).not.toContain('zoom.us/j/coach999888');
  });

  // CRITERION 5: A tenant can add a new product without code changes
  it('Criterion 5: A tenant can add a new product dynamically without application code changes', async () => {
    const customTenantId = 'custom-agency-tenant';
    const db = createMockDb(customTenantId) as unknown as SupabaseClient;

    const newOffer: TenantProductConfig = {
      productServiceId: 'ai_marketing_audit',
      productKey: 'ai_marketing_audit',
      tenantId: customTenantId,
      name: 'AI Marketing Audit',
      category: 'Digital Agency',
      description: 'Audit marketing campaigns and implement automated lead magnets',
      enabled: true,
      appointmentType: 'Marketing Audit Session',
      durationMinutes: 45,
      meetingMode: 'GOOGLE_MEET',
      tags: {
        interestTag: 'MARKETING_AUDIT_INTEREST',
        bookedTag: 'MARKETING_AUDIT_BOOKED',
      },
      ctaType: 'Call',
      teamName: 'Growth Team',
    };

    // Save product dynamically via upsertTenantProduct
    const saved = await upsertTenantProduct(db, customTenantId, newOffer);
    expect(saved).not.toBeNull();
    expect(saved?.productServiceId).toBe('ai_marketing_audit');

    // Intent detector detects this new product from the dynamic catalogue
    const det = detectTenantProductIntent(
      'Can you help with marketing campaigns and lead magnets? My name is Vikram.',
      [newOffer],
    );
    expect(det.products).toContain('ai_marketing_audit');
    expect(det.matchingConfigs[0].appointmentType).toBe('Marketing Audit Session');
  });

  // CRITERION 6: A tenant can configure a different duration and meeting provider
  it('Criterion 6: A tenant can configure a custom duration (90 min) and non-video meeting provider (phone/in-person)', async () => {
    const consultingTenantId = 'consulting-tenant-acc';
    const phoneConsulting: TenantProductConfig = {
      productServiceId: 'executive_coaching',
      productKey: 'executive_coaching',
      tenantId: consultingTenantId,
      name: 'Executive Coaching Call',
      category: 'Leadership',
      description: 'Senior executive strategy phone consultation',
      enabled: true,
      appointmentType: 'Phone Consultation',
      durationMinutes: 90,
      meetingMode: 'NONE',
      meetingLink: null,
      requiredFields: ['name'],
      optionalFields: ['email'],
      tags: {
        interestTag: 'EXEC_INTEREST',
        bookedTag: 'EXEC_BOOKED',
      },
      ctaType: 'Call',
      teamName: 'Executive Practice',
    };

    mockDbData.tenantProducts[consultingTenantId] = [phoneConsulting];
    const db = createMockDb(consultingTenantId) as unknown as SupabaseClient;

    const res = await runAiActionPipeline({
      db,
      accountId: consultingTenantId,
      contactId: 'contact-exec-1',
      conversationId: 'conv-exec-1',
      inboundText: 'I would like the executive coaching call tomorrow at 3 PM. Name is Sarah Jenkins.',
      messages: [{ role: 'user', content: 'I would like the executive coaching call tomorrow at 3 PM. Name is Sarah Jenkins.' }],
      contactRecord: { id: 'contact-exec-1', name: 'Sarah Jenkins', email: null },
    });

    expect(res.customerResponse).toContain('90 minutes');
    expect(res.customerResponse).toContain('Phone Consultation');
    // In NONE mode, no video link is invented
    expect(res.customerResponse).not.toContain('Google Meet');
    expect(res.customerResponse).not.toContain('zoom.us');
    expect(res.tagsAdded).toContain('EXEC_BOOKED');
  });

  // CRITERION 7: Email is not required when the configured provider permits booking without it
  it('Criterion 7: Email is not required when provider permits booking without email attendee', async () => {
    const db = createMockDb(coachAccountId) as unknown as SupabaseClient;
    // Customer has no email on file and provides no email in text
    const res = await runAiActionPipeline({
      db,
      accountId: coachAccountId,
      contactId: 'contact-phone-only',
      conversationId: 'conv-phone-only',
      inboundText: 'Book me for tomorrow 4 PM please. My name is Carlos.',
      messages: [{ role: 'user', content: 'Book me for tomorrow 4 PM please. My name is Carlos.' }],
      contactRecord: { id: 'contact-phone-only', name: 'Carlos', email: null },
    });

    // Booking must succeed without being blocked by missing email
    expect(res.tagsAdded).toContain('COACH_AUDIT_BOOKED');
    expect(res.customerResponse).toContain('Strategy Audit Call');
    expect(res.customerResponse).not.toContain('What is the best email address');
    // Does not promise an email invitation when no email was given
    expect(res.customerResponse).not.toContain('Calendar invitation has been sent to your email');
  });

  // CRITERION 8: Email alone never triggers booking
  it('Criterion 8: Email alone never triggers booking without date/time and demo intent', async () => {
    const db = createMockDb(coachAccountId) as unknown as SupabaseClient;
    const res = await runAiActionPipeline({
      db,
      accountId: coachAccountId,
      contactId: 'contact-email-only',
      conversationId: 'conv-email-only',
      inboundText: 'my email is carlos@example.com',
      messages: [{ role: 'user', content: 'my email is carlos@example.com' }],
      contactRecord: { id: 'contact-email-only', name: 'Carlos', email: null },
    });

    // Must NOT add booked tag
    expect(res.tagsAdded).not.toContain('COACH_AUDIT_BOOKED');
    expect(res.customerResponse).not.toContain('Your appointment is confirmed');
    expect(res.customerResponse).not.toContain('is booked');
  });

  // CRITERION 9: Calendar availability is checked before confirming
  it('Criterion 9: Calendar availability is checked and conflicts prevent false confirmations', async () => {
    const googleCal = await import('@/lib/calendar/google-calendar');
    // Force availability check to report conflict
    (googleCal.checkGoogleCalendarAvailability as unknown as { mockImplementationOnce: (fn: unknown) => void })
      .mockImplementationOnce(async () => ({
        available: false,
        conflictReason: 'Host calendar has another meeting at this time',
        suggestedSlots: ['2026-10-10T11:00:00.000Z', '2026-10-10T14:00:00.000Z'],
      }));

    const db = createMockDb(coachAccountId) as unknown as SupabaseClient;
    const res = await runAiActionPipeline({
      db,
      accountId: coachAccountId,
      contactId: 'contact-busy',
      conversationId: 'conv-busy',
      inboundText: 'Can we meet tomorrow at 4 PM? Name is Rahul.',
      messages: [{ role: 'user', content: 'Can we meet tomorrow at 4 PM? Name is Rahul.' }],
      contactRecord: { id: 'contact-busy', name: 'Rahul', email: 'rahul@example.com' },
    });

    expect(res.tagsAdded).not.toContain('COACH_AUDIT_BOOKED');
    expect(res.customerResponse).toContain('booked');
    expect(res.customerResponse).not.toContain('Confirmed');
  });

  // CRITERION 10: A failed external booking never produces a false confirmed status
  it('Criterion 10: A failed external booking never produces a false confirmed status', async () => {
    const googleCal = await import('@/lib/calendar/google-calendar');
    (googleCal.createGoogleCalendarBooking as unknown as { mockImplementationOnce: (fn: unknown) => void })
      .mockImplementationOnce(async () => {
        throw new Error('Google Calendar Service Unavailable');
      });

    const db = createMockDb(geniplusAccountId) as unknown as SupabaseClient;
    const res = await runAiActionPipeline({
      db,
      accountId: geniplusAccountId,
      contactId: 'contact-fail',
      conversationId: 'conv-fail',
      inboundText: 'Book Abacus demo tomorrow at 5 PM for Hitendra',
      messages: [{ role: 'user', content: 'Book Abacus demo tomorrow at 5 PM for Hitendra' }],
      contactRecord: { id: 'contact-fail', name: 'Hitendra', email: 'hitendra@example.com' },
    });

    expect(res.tagsAdded).not.toContain('DEMO_BOOKED');
    expect(res.customerResponse).not.toContain('demo is booked');
    expect(res.customerResponse).toContain('having trouble reserving that exact slot');
  });

  // CRITERION 11: CRM tags and assignments use the correct tenant configuration
  it('Criterion 11: CRM tags and assignments use the correct tenant configuration', async () => {
    const dbCoach = createMockDb(coachAccountId) as unknown as SupabaseClient;
    const coachProducts = await getTenantProducts(dbCoach, coachAccountId);

    expect(coachProducts[0]?.tags?.interestTag).toBe('COACH_AUDIT_INTEREST');
    expect(coachProducts[0]?.tags?.bookedTag).toBe('COACH_AUDIT_BOOKED');
    expect(coachProducts[0]?.teamName).toBe('Coaching Operations');

    const dbGeniplus = createMockDb(geniplusAccountId) as unknown as SupabaseClient;
    const geniplusProducts = await getTenantProducts(dbGeniplus, geniplusAccountId);
    const abacus = geniplusProducts.find((p) => p.productServiceId === 'ABACUS_KIDS');

    expect(abacus?.tags?.interestTag).toBe('ABACUS_KIDS_INTEREST');
    expect(abacus?.tags?.bookedTag).toBe('DEMO_BOOKED');
    expect(abacus?.teamName).toBe('Kids/Admissions');
  });

  // CRITERION 12: Existing Geniplus functionality continues to work
  it('Criterion 12: Existing Geniplus functionality continues to work across all 6 products', async () => {
    expect(Object.keys(DEFAULT_PRODUCT_CONFIGS)).toHaveLength(6);
    expect(DEFAULT_PRODUCT_CONFIGS.ABACUS_KIDS).toBeDefined();
    expect(DEFAULT_PRODUCT_CONFIGS.GTC).toBeDefined();
    expect(DEFAULT_PRODUCT_CONFIGS.RUBIKS_CUBE).toBeDefined();
    expect(DEFAULT_PRODUCT_CONFIGS.GOLD).toBeDefined();
    expect(DEFAULT_PRODUCT_CONFIGS.MAA).toBeDefined();
    expect(DEFAULT_PRODUCT_CONFIGS.LEAD_PILOT).toBeDefined();

    // Geniplus tenant loads all 6 seed products
    const dbGeniplus = createMockDb(geniplusAccountId) as unknown as SupabaseClient;
    const products = await getTenantProducts(dbGeniplus, geniplusAccountId);
    expect(products.map((p) => p.productServiceId)).toEqual(
      expect.arrayContaining(['ABACUS_KIDS', 'GTC', 'RUBIKS_CUBE', 'GOLD', 'MAA', 'LEAD_PILOT']),
    );
  });

  // CRITERION 13: Cross-tenant product, calendar, contact and meeting-link access is denied
  it('Criterion 13: Cross-tenant product, calendar, contact and meeting-link access is strictly isolated', async () => {
    const dbCoach = createMockDb(coachAccountId) as unknown as SupabaseClient;

    // Coach cannot access Fitness trainer's product by ID
    const crossProduct = await getTenantProductById(
      dbCoach,
      coachAccountId,
      'personal_training_trial',
    );
    expect(crossProduct).toBeNull();

    // Fitness trainer cannot access Coach's product by ID
    const dbFitness = createMockDb(fitnessAccountId) as unknown as SupabaseClient;
    const crossProduct2 = await getTenantProductById(
      dbFitness,
      fitnessAccountId,
      'biz_scaling_audit',
    );
    expect(crossProduct2).toBeNull();

    // Non-Geniplus tenant NEVER receives Geniplus Abacus products
    const coachProducts = await getTenantProducts(dbCoach, coachAccountId);
    const hasAbacusInCoach = coachProducts.some((p) => p.productServiceId === 'ABACUS_KIDS');
    expect(hasAbacusInCoach).toBe(false);
  });
});
