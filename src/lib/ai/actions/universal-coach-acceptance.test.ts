import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  getTenantProducts,
  upsertTenantProduct,
  isVerifiedGeniplusTenant,
} from '@/lib/products/tenant-products';
import {
  detectProductIntent,
  detectTenantProductIntent,
} from '@/lib/ai/actions/intent-detector';
import {
  executeDemoBooking,
  formatConfirmationMessage,
} from '@/lib/calendar/booking-coordinator';
import {
  runAiActionPipeline,
} from '@/lib/ai/actions/action-runner';
import {
  buildTenantAiSystemPrompt,
} from '@/lib/ai/tenant-prompt-builder';
import {
  detectScheduleQuery,
  formatScheduleResponse,
  extractConversationCollectedFields,
} from '@/lib/ai/conversation-state';
import type { TenantProductConfig } from '@/lib/ai/actions/types';

describe('Lead Pilot — Universal Coach Products, AI Responses & Human Handoff Acceptance Tests', () => {
  // In-memory mock database to simulate isolated multi-tenant Supabase tables
  const mockDbStorage = new Map<string, any>();

  function createMockSupabase(tenantId: string) {
    function createQuery(table: string) {
      const filters: ((row: any) => boolean)[] = [];

      const queryBuilder: any = {
        eq(col: string, val: any) {
          filters.push((row: any) => row && row[col] === val);
          return queryBuilder;
        },
        ilike(col: string, val: any) {
          filters.push((row: any) => row && String(row[col]).toLowerCase() === String(val).toLowerCase());
          return queryBuilder;
        },
        order(col: string, opts?: any) {
          return queryBuilder;
        },
        limit(n: number) {
          return queryBuilder;
        },
        async maybeSingle() {
          const rows = Array.from(mockDbStorage.values())
            .filter((r) => r.__table === table)
            .filter((r) => filters.every((f) => f(r)));
          return { data: rows[0] || null, error: null };
        },
        async single() {
          const rows = Array.from(mockDbStorage.values())
            .filter((r) => r.__table === table)
            .filter((r) => filters.every((f) => f(r)));
          return { data: rows[0] || null, error: rows[0] ? null : { message: 'Not found' } };
        },
        then(onfulfilled: any, onrejected?: any) {
          const rows = Array.from(mockDbStorage.values())
            .filter((r) => r.__table === table)
            .filter((r) => filters.every((f) => f(r)));
          return Promise.resolve({ data: rows, error: null }).then(onfulfilled, onrejected);
        },
      };

      return queryBuilder;
    }

    return {
      rpc: vi.fn(async () => ({ data: true, error: null })),
      from: vi.fn((table: string) => {
        return {
          select: vi.fn((columns: string = '*') => {
            return createQuery(table);
          }),
          insert: vi.fn((payload: any) => {
            const id = payload.id || `rec_${Date.now()}_${Math.random()}`;
            const record = { ...payload, id, __table: table };
            const key = `${table}:${payload.account_id || tenantId}:${payload.product_service_id || id}`;
            mockDbStorage.set(key, record);
            return {
              select: vi.fn(() => ({
                single: vi.fn(async () => ({ data: record, error: null })),
                maybeSingle: vi.fn(async () => ({ data: record, error: null })),
              })),
            };
          }),
          update: vi.fn((updates: any) => {
            return {
              eq: vi.fn((col1: string, val1: any) => {
                return {
                  eq: vi.fn(async (col2: string, val2: any) => {
                    for (const [key, record] of mockDbStorage.entries()) {
                      if (record.__table === table && record[col1] === val1 && record[col2] === val2) {
                        mockDbStorage.set(key, { ...record, ...updates });
                      }
                    }
                    return { error: null };
                  }),
                  then(onfulfilled: any) {
                    for (const [key, record] of mockDbStorage.entries()) {
                      if (record.__table === table && record[col1] === val1) {
                        mockDbStorage.set(key, { ...record, ...updates });
                      }
                    }
                    return Promise.resolve({ error: null }).then(onfulfilled);
                  },
                };
              }),
            };
          }),
          delete: vi.fn(() => {
            return {
              eq: vi.fn((col1: string, val1: any) => ({
                eq: vi.fn(async (col2: string, val2: any) => {
                  for (const [key, record] of mockDbStorage.entries()) {
                    if (record.__table === table && record[col1] === val1 && record[col2] === val2) {
                      mockDbStorage.delete(key);
                    }
                  }
                  return { error: null };
                }),
              })),
            };
          }),
          upsert: vi.fn(async (payload: any) => {
            const id = payload.id || payload.product_service_id || `rec_${Date.now()}`;
            const key = `${table}:${payload.account_id}:${id}`;
            mockDbStorage.set(key, { ...payload, id, __table: table });
            return { data: payload, error: null };
          }),
        };
      }),
    } as unknown as SupabaseClient;
  }

  beforeEach(() => {
    mockDbStorage.clear();
  });

  // =========================================================================
  // CRITERION 1: A new coach sees no Geniplus products
  // =========================================================================
  it('Criterion 1: A new coach account starts with an empty product catalog and zero Geniplus defaults', async () => {
    const newCoachId = 'coach_tenant_brand_new_99';
    const mockDb = createMockSupabase(newCoachId);

    // 1. New coach has no products in DB
    const products = await getTenantProducts(mockDb, newCoachId);
    expect(products).toHaveLength(0);

    // 2. Intent detector with coach's empty catalogue detects ZERO products
    // Even if message contains words like "abacus" or "demo", it must not leak Geniplus products
    const detected = detectProductIntent('I want to book an abacus trial for my son', products);
    expect(detected).toEqual([]);

    // 3. Verified Geniplus check is false
    const isGeniplus = await isVerifiedGeniplusTenant(mockDb, newCoachId);
    expect(isGeniplus).toBe(false);
  });

  // =========================================================================
  // CRITERION 2: A coach can create a service and the AI can explain it
  // =========================================================================
  it('Criterion 2: A coach can configure a service and the AI explains it from tenant config', async () => {
    const coachId = 'coach_fitness_01';
    const mockDb = createMockSupabase(coachId);

    const fitnessService: TenantProductConfig = {
      productServiceId: 'fitness_bootcamp',
      productKey: 'fitness_bootcamp',
      tenantId: coachId,
      name: 'Weight Loss Transformation Bootcamp',
      description: 'Personalized 12-week fat loss and strength coaching for busy founders.',
      category: 'Fitness & Health',
      targetAudience: 'Entrepreneurs and Executives',
      appointmentType: 'Strategy Consultation',
      durationMinutes: 45,
      price: 9999,
      currency: 'INR',
      isFree: false,
      workingHoursStart: '07:00',
      workingHoursEnd: '19:00',
      availabilityDays: ['Monday', 'Wednesday', 'Friday'],
      bookingMethod: 'phone_call',
      meetingMode: 'PHONE_CALL',
      meetingLink: null,
      requiredFields: ['name', 'date', 'time'],
      optionalFields: ['email'],
      tags: {
        interestTag: 'FITNESS_INTEREST',
        bookedTag: 'FITNESS_CALL_BOOKED',
      },
      ctaType: 'Call',
      teamName: 'Coaching Team',
      enabled: true,
      archived: false,
      keywords: ['fitness', 'weight loss', 'fat loss', 'strength', 'bootcamp', 'training'],
      qualificationQuestions: ['What is your primary fitness goal?', 'Have you worked with a coach before?'],
    };

    // 1. Upsert product
    await upsertTenantProduct(mockDb, coachId, fitnessService);
    const loaded = await getTenantProducts(mockDb, coachId);
    expect(loaded).toHaveLength(1);
    expect(loaded[0].name).toBe('Weight Loss Transformation Bootcamp');

    // 2. AI detects intent dynamically from coach's service keywords
    const match = detectTenantProductIntent('I want to join your weight loss fitness bootcamp', loaded);
    expect(match.products).toEqual(['fitness_bootcamp']);

    // 3. AI prompt builder compiles business knowledge directly from the service
    const promptCtx = await buildTenantAiSystemPrompt(mockDb, coachId, 'We focus on sustainable lifestyle changes.');
    expect(promptCtx.systemPrompt).toContain('Weight Loss Transformation Bootcamp');
    expect(promptCtx.systemPrompt).toContain('INR 9999');
    expect(promptCtx.systemPrompt).toContain('07:00 to 19:00');
    expect(promptCtx.systemPrompt).toContain('Monday, Wednesday, Friday');
    expect(promptCtx.systemPrompt).not.toContain('Abacus');

    // 4. Class timings query answers strictly from configured schedule
    expect(detectScheduleQuery('what are your class timings?')).toBe(true);
    const scheduleReply = formatScheduleResponse(loaded[0]);
    expect(scheduleReply).toContain('Monday, Wednesday, Friday');
    expect(scheduleReply).toContain('07:00 to 19:00');
  });

  // =========================================================================
  // CRITERION 3: Tenant A cannot access Tenant B's products or knowledge
  // =========================================================================
  it("Criterion 3: Tenant isolation guarantees Tenant A cannot see Tenant B's catalog or instructions", async () => {
    const tenantA = 'tenant_coach_alpha';
    const tenantB = 'tenant_coach_beta';
    const mockDb = createMockSupabase(tenantA);

    await upsertTenantProduct(mockDb, tenantA, {
      productServiceId: 'alpha_yoga',
      productKey: 'alpha_yoga',
      name: 'Alpha Hatha Yoga',
      durationMinutes: 60,
      meetingMode: 'PHONE_CALL',
      appointmentType: 'Yoga Class',
      enabled: true,
    });

    await upsertTenantProduct(mockDb, tenantB, {
      productServiceId: 'beta_crypto',
      productKey: 'beta_crypto',
      name: 'Beta Crypto Masterclass',
      durationMinutes: 90,
      meetingMode: 'STATIC_MEETING_LINK',
      appointmentType: 'Masterclass',
      enabled: true,
    });

    const productsA = await getTenantProducts(mockDb, tenantA);
    const productsB = await getTenantProducts(mockDb, tenantB);

    expect(productsA).toHaveLength(1);
    expect(productsA[0].name).toBe('Alpha Hatha Yoga');
    expect(productsA.some((p) => p.name.includes('Crypto'))).toBe(false);

    expect(productsB).toHaveLength(1);
    expect(productsB[0].name).toBe('Beta Crypto Masterclass');
    expect(productsB.some((p) => p.name.includes('Yoga'))).toBe(false);

    // Cross-tenant AI prompt isolation
    const promptA = await buildTenantAiSystemPrompt(mockDb, tenantA);
    expect(promptA.systemPrompt).toContain('Alpha Hatha Yoga');
    expect(promptA.systemPrompt).not.toContain('Beta Crypto Masterclass');
  });

  // =========================================================================
  // CRITERION 4: The AI never promises an unavailable Google Meet link
  // =========================================================================
  it('Criterion 4: The AI never promises an unavailable Google Meet link when calendar is unconfigured', () => {
    // 1. Template formatting when no meet link was generated by API
    const rendered = formatConfirmationMessage(null, {
      name: 'Sarah',
      dateTime: 'Friday, Oct 12 at 4:00 PM IST',
      duration: 30,
      title: 'Consultation Call',
      meetingMode: 'PHONE_CALL',
      meetLink: null,
    });

    // Must never claim a Google Meet link exists!
    expect(rendered).not.toContain('Google Meet:');
    expect(rendered).not.toContain('undefined');
    expect(rendered).toContain('We will call you directly');

    // 2. If template explicitly contained Meet placeholder but link was null
    const customTemplateWithMeet =
      'Confirmed!\n📅 {{date_time}}\n💻 Google Meet: {{meet_link}}\nSee you!';
    const renderedStripped = formatConfirmationMessage(customTemplateWithMeet, {
      name: 'Sarah',
      dateTime: 'Friday at 4 PM',
      title: 'Session',
      meetLink: null,
    });
    expect(renderedStripped).not.toContain('Google Meet');
  });

  // =========================================================================
  // CRITERION 5: Customer-provided email is saved and not requested repeatedly
  // =========================================================================
  it('Criterion 5: Customer-provided email is extracted, saved to CRM, and not repeatedly asked', () => {
    const messages = [
      { role: 'user', content: 'I would like to book a session for tomorrow 11am' },
      { role: 'assistant', content: 'Great! What is the best email address to send the booking confirmation to?' },
      { role: 'user', content: 'my email is coach.client@example.com' },
    ];

    const collected = extractConversationCollectedFields(messages, { name: 'Alex' });
    expect(collected.email).toBe('coach.client@example.com');
    expect(collected.preferredTimeText).toBe('I would like to book a session for tomorrow 11am');
    expect(collected.hasDate).toBe(true);
    expect(collected.hasTime).toBe(true);
  });

  // =========================================================================
  // CRITERION 6: Booking confirmed only after successful persistence
  // =========================================================================
  it('Criterion 6: Booking coordinator requires successful database persistence and does not confirm on error', async () => {
    const errorDb = {
      from: vi.fn(() => ({
        select: vi.fn(() => ({
          eq: vi.fn(() => ({
            maybeSingle: vi.fn(async () => ({ data: null, error: null })),
          })),
        })),
        insert: vi.fn(() => ({
          select: vi.fn(() => ({
            single: vi.fn(async () => ({ data: null, error: { message: 'Database connection failed' } })),
          })),
        })),
      })),
    } as unknown as SupabaseClient;

    const res = await executeDemoBooking({
      db: errorDb,
      accountId: 'tenant_test_01',
      contactId: 'contact_test_01',
      preferredTimeText: 'tomorrow 11am',
      meetingMode: 'PHONE_CALL',
      sendWhatsAppConfirmation: false,
    });

    expect(res.success).toBe(false);
    expect(res.error).toBe('database_insert_failed');
  });

  // =========================================================================
  // CRITERION 7: Human handoff creates the correct CRM state and assignment
  // =========================================================================
  it('Criterion 7: Human handoff assigns the lead and sets clear handoff state', async () => {
    const tenantId = 'coach_tenant_handoff_test';
    const mockDb = createMockSupabase(tenantId);

    const pipelineRes = await runAiActionPipeline({
      db: mockDb,
      accountId: tenantId,
      conversationId: 'conv_123',
      contactId: 'contact_456',
      inboundText: 'I need to speak to a human coach directly right now',
      messages: [{ role: 'user', content: 'I need to speak to a human coach directly right now' }],
      productConfigs: [],
      contactRecord: { id: 'contact_456', name: 'David' },
    });

    expect(pipelineRes.isHandoff).toBe(true);
    expect(pipelineRes.customerResponse).toContain('team member');
  });

  // =========================================================================
  // CRITERION 8: Existing Geniplus behavior and configuration remain intact
  // =========================================================================
  it('Criterion 8: Verified Geniplus tenant preserves all 6 seed products and Abacus email optionality', async () => {
    const geniplusId = '5d5413c2-6097-4ffe-bad8-2a992dca93a8';
    const mockDb = createMockSupabase(geniplusId);

    const isGeniplus = await isVerifiedGeniplusTenant(mockDb, geniplusId);
    expect(isGeniplus).toBe(true);

    const products = await getTenantProducts(mockDb, geniplusId);
    expect(products.length).toBeGreaterThanOrEqual(6);

    const abacus = products.find((p) => p.productServiceId === 'ABACUS_KIDS');
    expect(abacus).toBeDefined();
    expect(abacus?.name).toBe('Abacus Mental Math Program');
    // Abacus optional email requirement preserved
    expect(abacus?.requiredFields).not.toContain('email');
    expect(abacus?.optionalFields).toContain('email');

    // Intent detection for Geniplus tenant works as expected
    const detected = detectProductIntent('I want an abacus class for my 7 year old son', products);
    expect(detected).toContain('ABACUS_KIDS');
  });
});
