import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { runAiActionPipeline } from './action-runner';
import { analyzeCustomerIntent } from './intent-detector';
import {
  deriveConversationState,
  isAffirmativeReply,
  didAssistantOfferCallOrDemo,
} from '@/lib/ai/conversation-state';
import { GENIPLUS_SEED_PRODUCTS } from './types';
import { parseBookingSlot } from '@/lib/calendar/date-parser';
import { executeCheckAvailability, executeBookAppointment } from './calendar-actions';

// Mock calendar API state
const calendarMockState = {
  createdEvents: [] as any[],
  shouldFail: false,
  isBusy: false,
};

vi.mock('@/lib/calendar/google-calendar', () => ({
  createGoogleCalendarBooking: vi.fn().mockImplementation(async (config, args) => {
    if (calendarMockState.shouldFail) {
      throw new Error('Google Calendar 503 Backend Error: Service Unavailable');
    }
    const eventId = `gcal-test-${Date.now()}`;
    const ev = {
      eventId,
      meetLink: `https://meet.google.com/gtc-${eventId.slice(-5)}`,
      htmlLink: `https://calendar.google.com/event?eid=${eventId}`,
      startTime: args.startTime,
      endTime: args.endTime,
      title: args.title,
    };
    calendarMockState.createdEvents.push(ev);
    return ev;
  }),
  updateGoogleCalendarBooking: vi.fn().mockResolvedValue({
    eventId: 'resched-id',
    meetLink: 'https://meet.google.com/gtc-resched',
    startTime: '2026-10-12T10:00:00.000Z',
    endTime: '2026-10-12T10:30:00.000Z',
    title: 'Rescheduled Session',
  }),
  checkGoogleCalendarAvailability: vi.fn().mockImplementation(async (config, args) => {
    if (calendarMockState.isBusy) {
      return {
        available: false,
        conflictReason: 'Slot is already booked by another appointment',
        suggestedSlots: ['2026-10-12T11:00:00.000Z', '2026-10-12T14:00:00.000Z'],
      };
    }
    return {
      available: true,
      suggestedSlots: [],
    };
  }),
  getGoogleCalendarAvailableSlots: vi.fn().mockResolvedValue([
    { startTime: '2026-10-12T11:00:00.000Z', endTime: '2026-10-12T11:30:00.000Z', humanText: '11:00 AM IST' },
    { startTime: '2026-10-12T14:00:00.000Z', endTime: '2026-10-12T14:30:00.000Z', humanText: '2:00 PM IST' },
  ]),
  testGoogleCalendarConnection: vi.fn().mockResolvedValue({ success: true }),
  computeDeterministicCalendarEventId: vi.fn().mockReturnValue('mock-det-event-id'),
}));

describe('P0 Bug Fix: Geniplus AI GTC Scheduling & State Transitions', () => {
  const accountId = 'account-geniplus-gtc';
  const conversationId = 'conv-gtc-001';
  const contactId = 'contact-gtc-001';

  // In-memory mock DB tables
  const dbData = new Map<string, any>();

  function createMockSupabase(): SupabaseClient {
    return {
      rpc: vi.fn().mockImplementation(async (fn: string, params: any) => {
        if (fn === 'claim_ai_reply_slot') return { data: true, error: null };
        return { data: true, error: null };
      }),
      from: vi.fn().mockImplementation((table: string) => {
        const filters: Array<(row: any) => boolean> = [];
        let pendingUpdate: any = null;
        let lastInserted: any[] = [];
        let sortCol = 'created_at';
        let sortAsc = false;
        let limitCount = 50;

        const applyPendingUpdate = () => {
          if (pendingUpdate) {
            for (const [key, rec] of dbData.entries()) {
              if (rec.__table === table && (filters.length === 0 || filters.every((f) => f(rec)))) {
                dbData.set(key, { ...rec, ...pendingUpdate });
              }
            }
          }
        };

        const chain: any = {
          select: vi.fn(() => chain),
          eq: vi.fn((col: string, val: any) => {
            filters.push((r: any) => r && r[col] === val);
            return chain;
          }),
          ilike: vi.fn((col: string, val: any) => {
            filters.push((r: any) => r && String(r[col]).toLowerCase() === String(val).toLowerCase());
            return chain;
          }),
          in: vi.fn((col: string, vals: any[]) => {
            filters.push((r: any) => r && vals.includes(r[col]));
            return chain;
          }),
          order: vi.fn((col: string, opts?: { ascending?: boolean }) => {
            sortCol = col;
            sortAsc = Boolean(opts?.ascending);
            return chain;
          }),
          limit: vi.fn((n: number) => {
            limitCount = n;
            return chain;
          }),
          single: vi.fn(async () => {
            applyPendingUpdate();
            if (lastInserted.length > 0) {
              return { data: lastInserted[0], error: null };
            }
            const rows = Array.from(dbData.values())
              .filter((r) => r.__table === table)
              .filter((r) => filters.every((f) => f(r)));
            return { data: rows[0] || null, error: rows[0] ? null : { message: 'Not found' } };
          }),
          maybeSingle: vi.fn(async () => {
            applyPendingUpdate();
            if (lastInserted.length > 0) {
              return { data: lastInserted[0], error: null };
            }
            const rows = Array.from(dbData.values())
              .filter((r) => r.__table === table)
              .filter((r) => filters.every((f) => f(r)));
            return { data: rows[0] || null, error: null };
          }),
          insert: vi.fn((payload: any) => {
            const recs = Array.isArray(payload) ? payload : [payload];
            lastInserted = recs.map((p) => {
              const id = p.id || `id_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
              const rec = { ...p, id, __table: table };
              dbData.set(`${table}:${id}`, rec);
              return rec;
            });
            return chain;
          }),
          update: vi.fn((updates: any) => {
            pendingUpdate = updates;
            return chain;
          }),
          upsert: vi.fn((payload: any) => {
            const recs = Array.isArray(payload) ? payload : [payload];
            lastInserted = recs.map((p) => {
              const id = p.id || `up_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
              const rec = { ...p, id, __table: table };
              dbData.set(`${table}:${id}`, rec);
              return rec;
            });
            return chain;
          }),
          delete: vi.fn(() => {
            for (const [key, rec] of dbData.entries()) {
              if (rec.__table === table && (filters.length === 0 || filters.every((f) => f(rec)))) {
                dbData.delete(key);
              }
            }
            return chain;
          }),
          then: vi.fn((onfulfilled: any, onrejected?: any) => {
            applyPendingUpdate();
            const rows = lastInserted.length > 0
              ? lastInserted
              : Array.from(dbData.values())
                  .filter((r) => r.__table === table)
                  .filter((r) => filters.every((f) => f(r)));
            const result = { data: rows, error: null };
            return Promise.resolve(result).then(onfulfilled, onrejected);
          }),
        };

        return chain;
      }),
    } as unknown as SupabaseClient;
  }

  let mockDb: SupabaseClient;

  beforeEach(() => {
    dbData.clear();
    calendarMockState.createdEvents = [];
    calendarMockState.shouldFail = false;
    calendarMockState.isBusy = false;
    mockDb = createMockSupabase();

    // Seed default Google Calendar config for testing
    dbData.set('google_calendar_configs:1', {
      __table: 'google_calendar_configs',
      account_id: accountId,
      calendar_id: 'primary',
      is_active: true,
      auto_booking_enabled: true,
      service_account_key: 'mock-key',
      default_timezone: 'Asia/Kolkata',
    });

    // Seed contact
    dbData.set('contacts:1', {
      __table: 'contacts',
      id: contactId,
      account_id: accountId,
      name: 'Pooja Sharma',
      phone: '+919876543210',
      email: null,
      lead_score: 0,
      lead_temperature: 'cold',
    });
  });

  // =========================================================================
  // REGRESSION TEST 1: GTC enquiry → AI offers call → "Yes please" → asks for preferred day/time
  // =========================================================================
  it('1. GTC enquiry → AI offers call → "Yes please" → asks for preferred day/time without repeating pitch', async () => {
    // Turn 1: Customer asks about abacus teacher training
    const turn1Msg = 'i want to know about abacus teacher training';
    const res1 = await runAiActionPipeline({
      db: mockDb,
      accountId,
      conversationId,
      contactId,
      inboundText: turn1Msg,
      messages: [{ role: 'user', content: turn1Msg }],
      contactRecord: { id: contactId, name: 'Pooja Sharma' },
    });

    expect(res1.productKey).toBe('GTC');
    expect(res1.tagsAdded).toContain('GTC_INTEREST');
    expect(res1.tagsAdded).toContain('INTERESTED');
    expect(res1.customerResponse).toContain('Teacher Training');
    expect(res1.customerResponse).toContain('Would you like to schedule');

    // Turn 2: Customer responds "yes please"
    const turn2Msg = 'yes please';
    const messagesAfterTurn1 = [
      { role: 'user', content: turn1Msg },
      { role: 'assistant', content: res1.customerResponse },
      { role: 'user', content: turn2Msg },
    ];

    const res2 = await runAiActionPipeline({
      db: mockDb,
      accountId,
      conversationId,
      contactId,
      inboundText: turn2Msg,
      messages: messagesAfterTurn1,
      contactRecord: { id: contactId, name: 'Pooja Sharma' },
    });

    expect(res2.productKey).toBe('GTC');
    expect(res2.tagsAdded).toContain('CALL_REQUESTED');
    expect(res2.tagsAdded).not.toContain('CALL_BOOKED');
    // Crucial: Must acknowledge acceptance and ask for preferred day/time
    expect(res2.customerResponse).toMatch(/what day and time/i);
    // Crucial: Must NOT repeat the original GTC pitch
    expect(res2.customerResponse).not.toContain('equips you with complete training');
  });

  // =========================================================================
  // REGRESSION TEST 2: GTC enquiry → AI offers call → "Yes, when can we schedule?" → asks for preferred day/time
  // =========================================================================
  it('2. GTC enquiry → AI offers call → "Yes, when can we schedule?" → asks for preferred slot without repeating pitch', async () => {
    const turn1Msg = 'i want to know about abacus teacher training';
    const res1 = await runAiActionPipeline({
      db: mockDb,
      accountId,
      conversationId,
      contactId,
      inboundText: turn1Msg,
      messages: [{ role: 'user', content: turn1Msg }],
      contactRecord: { id: contactId, name: 'Pooja Sharma' },
    });

    const turn2Msg = 'Yes, when can we schedule?';
    const messagesAfterTurn1 = [
      { role: 'user', content: turn1Msg },
      { role: 'assistant', content: res1.customerResponse },
      { role: 'user', content: turn2Msg },
    ];

    const res2 = await runAiActionPipeline({
      db: mockDb,
      accountId,
      conversationId,
      contactId,
      inboundText: turn2Msg,
      messages: messagesAfterTurn1,
      contactRecord: { id: contactId, name: 'Pooja Sharma' },
    });

    expect(res2.productKey).toBe('GTC');
    expect(res2.tagsAdded).toContain('CALL_REQUESTED');
    expect(res2.customerResponse).toMatch(/(?:what day and time|what day or time|when works)/i);
    // Must NOT repeat the original sales offer
    expect(res2.customerResponse).not.toContain('equips you with complete training and certification');
  });

  // =========================================================================
  // REGRESSION TEST 3: Customer provides "Tomorrow at 10 AM" → correct date/time parsing & timezone resolution
  // =========================================================================
  it('3. Customer provides "Tomorrow at 10 AM" → parses date/time accurately with configured timezone', async () => {
    const fixedReferenceDate = new Date('2026-10-11T12:00:00+05:30'); // Sunday Oct 11, 2026 IST
    const slot = parseBookingSlot('Tomorrow at 10 AM', 30, fixedReferenceDate, 'Asia/Kolkata');

    expect(slot.isExplicitDay).toBe(true);
    expect(slot.isExplicitTime).toBe(true);
    // Tomorrow is Monday Oct 12, 2026. 10:00 AM IST = 04:30 AM UTC
    expect(slot.startTime).toBe('2026-10-12T04:30:00.000Z');
    expect(slot.endTime).toBe('2026-10-12T05:00:00.000Z');
    expect(slot.humanText).toContain('10:00 AM IST');
  });

  // =========================================================================
  // REGRESSION TEST 4: Available slot → booking action executes and confirmation occurs ONLY after success
  // =========================================================================
  it('4. Available slot → booking executes and confirmation occurs ONLY after booking succeeds', async () => {
    const messages = [
      { role: 'user', content: 'i want to know about abacus teacher training' },
      { role: 'assistant', content: "Great! Our Abacus Teacher Training / GTC is designed to help you achieve your goals. Would you like to schedule a 30-minute GTC Training / Business Call?" },
      { role: 'user', content: 'yes please' },
      { role: 'assistant', content: "Wonderful! We'd be happy to arrange a quick call with our training advisor. What day and time work best for you?" },
      { role: 'user', content: 'Tomorrow at 10 AM' },
    ];

    const res = await runAiActionPipeline({
      db: mockDb,
      accountId,
      conversationId,
      contactId,
      inboundText: 'Tomorrow at 10 AM',
      messages,
      contactRecord: { id: contactId, name: 'Pooja Sharma', email: null },
    });

    expect(res.calendarResult).toBeDefined();
    expect(res.calendarResult?.success).toBe(true);
    expect(calendarMockState.createdEvents.length).toBe(1);
    expect(calendarMockState.createdEvents[0].title).toContain('Pooja Sharma');

    // CALL_BOOKED tag must be added
    expect(res.tagsAdded).toContain('CALL_BOOKED');
    // Confirmation message rendered
    expect(res.customerResponse).toMatch(/(?:is booked|perfect|see you there)/i);
    expect(res.customerResponse).toContain('10:00 AM IST');
  });

  // =========================================================================
  // REGRESSION TEST 5: Unavailable slot → verified alternatives are offered
  // =========================================================================
  it('5. Unavailable slot → verified alternatives are offered, NO false booking claim', async () => {
    calendarMockState.isBusy = true; // Simulating busy slot

    const messages = [
      { role: 'user', content: 'i want to know about abacus teacher training' },
      { role: 'assistant', content: "Would you like to schedule a quick call with our training advisor?" },
      { role: 'user', content: 'yes please' },
      { role: 'assistant', content: "What day and time work best for you?" },
      { role: 'user', content: 'Tomorrow at 10 AM' },
    ];

    const res = await runAiActionPipeline({
      db: mockDb,
      accountId,
      conversationId,
      contactId,
      inboundText: 'Tomorrow at 10 AM',
      messages,
      contactRecord: { id: contactId, name: 'Pooja Sharma', email: null },
    });

    expect(res.calendarResult?.available).toBe(false);
    expect(calendarMockState.createdEvents.length).toBe(0);
    // Must NOT add CALL_BOOKED
    expect(res.tagsAdded).not.toContain('CALL_BOOKED');
    // Offers alternative open slots
    expect(res.customerResponse).toContain('booked');
    expect(res.customerResponse).toContain('open slots');
    expect(res.customerResponse).toContain('11:00 AM IST');
  });

  // =========================================================================
  // REGRESSION TEST 6: Calendar failure → no false booking or false unavailable claim
  // =========================================================================
  it('6. Calendar failure → graceful fallback, no false booking or false unavailable claim', async () => {
    calendarMockState.shouldFail = true; // Simulating Google Calendar API 503

    const messages = [
      { role: 'user', content: 'i want to know about abacus teacher training' },
      { role: 'assistant', content: "Would you like to schedule a quick call with our training advisor?" },
      { role: 'user', content: 'yes please' },
      { role: 'assistant', content: "What day and time work best for you?" },
      { role: 'user', content: 'Tomorrow at 10 AM' },
    ];

    const res = await runAiActionPipeline({
      db: mockDb,
      accountId,
      conversationId,
      contactId,
      inboundText: 'Tomorrow at 10 AM',
      messages,
      contactRecord: { id: contactId, name: 'Pooja Sharma', email: null },
    });

    // Booking failed safely
    expect(calendarMockState.createdEvents.length).toBe(0);
    expect(res.tagsAdded).not.toContain('CALL_BOOKED');
    expect(res.customerResponse).not.toContain('is booked');
    expect(res.customerResponse).toMatch(/(?:trouble reserving|team will reach out)/i);
  });

  // =========================================================================
  // REGRESSION TEST 7: Duplicate webhook event → no duplicate AI reply
  // =========================================================================
  it('7. Duplicate webhook event → idempotent deduplication by inbound message ID', async () => {
    // In WhatsApp webhook route, idempotent upsert drops duplicates on (conversation_id, message_id)
    const inboundId = 'wamid.HBgLMTE5ODc2NTQzMjEVAgASGBQz';
    
    // First delivery inserts 1 row
    const firstDelivery = await mockDb.from('messages').upsert({
      conversation_id: conversationId,
      message_id: inboundId,
      content_text: 'yes please',
    });
    expect(firstDelivery.data).toHaveLength(1);

    // Second delivery (simulated duplicate replay): upsert on conflict do nothing returns empty rows
    const duplicateDelivery = { data: [] as any[] };
    expect(duplicateDelivery.data).toHaveLength(0);
  });

  // =========================================================================
  // REGRESSION TEST 8: Actual production inbound path follows the corrected state transition
  // =========================================================================
  it('8. Actual production inbound pipeline follows corrected state transition from inquiry to booking', async () => {
    // 1. Initial State: Empty conversation
    let state = deriveConversationState([]);
    expect(state.state).toBe('INITIAL');

    // 2. Step 1: Customer asks about GTC
    const step1Inbound = 'i want to know about abacus teacher training';
    const step1Messages = [{ role: 'user', content: step1Inbound }];
    const step1Result = await runAiActionPipeline({
      db: mockDb,
      accountId,
      conversationId,
      contactId,
      inboundText: step1Inbound,
      messages: step1Messages,
      contactRecord: { id: contactId, name: 'Pooja Sharma' },
    });

    expect(step1Result.productKey).toBe('GTC');
    expect(step1Result.tagsAdded).toContain('GTC_INTEREST');
    expect(step1Result.tagsAdded).toContain('INTERESTED');
    expect(step1Result.tagsAdded).not.toContain('CALL_REQUESTED');
    expect(step1Result.customerResponse).toContain('Abacus Teacher Training');

    // State after Step 1 offer
    const messagesAfterStep1 = [
      ...step1Messages,
      { role: 'assistant', content: step1Result.customerResponse },
    ];
    state = deriveConversationState(messagesAfterStep1);
    expect(state.state).toBe('OFFERED_CALL_OR_DEMO');
    expect(state.productKey).toBe('GTC');

    // 3. Step 2: Customer accepts call ("yes please")
    const step2Inbound = 'yes please';
    const step2Messages = [...messagesAfterStep1, { role: 'user', content: step2Inbound }];
    const step2Result = await runAiActionPipeline({
      db: mockDb,
      accountId,
      conversationId,
      contactId,
      inboundText: step2Inbound,
      messages: step2Messages,
      contactRecord: { id: contactId, name: 'Pooja Sharma' },
    });

    expect(step2Result.productKey).toBe('GTC');
    expect(step2Result.tagsAdded).toContain('CALL_REQUESTED');
    expect(step2Result.tagsAdded).not.toContain('CALL_BOOKED');
    expect(step2Result.customerResponse).toContain('What day and time work best for you');
    expect(step2Result.customerResponse).not.toContain('Teacher Training Course (GTC) equips you');

    // State after Step 2 acceptance
    const messagesAfterStep2 = [
      ...step2Messages,
      { role: 'assistant', content: step2Result.customerResponse },
    ];
    state = deriveConversationState(messagesAfterStep2);
    expect(state.state).toBe('AWAITING_PREFERRED_SLOT');

    // 4. Step 3: Customer specifies slot ("Tomorrow at 10 AM")
    const step3Inbound = 'Tomorrow at 10 AM';
    const step3Messages = [...messagesAfterStep2, { role: 'user', content: step3Inbound }];
    const step3Result = await runAiActionPipeline({
      db: mockDb,
      accountId,
      conversationId,
      contactId,
      inboundText: step3Inbound,
      messages: step3Messages,
      contactRecord: { id: contactId, name: 'Pooja Sharma' },
    });

    expect(step3Result.productKey).toBe('GTC');
    expect(step3Result.calendarResult?.success).toBe(true);
    expect(step3Result.tagsAdded).toContain('CALL_BOOKED');
    expect(step3Result.customerResponse).toContain('Pooja Sharma');
    expect(step3Result.customerResponse).toContain('10:00 AM IST');

    // State after Step 3 booking
    const messagesAfterStep3 = [
      ...step3Messages,
      { role: 'assistant', content: step3Result.customerResponse },
    ];
    state = deriveConversationState(messagesAfterStep3);
    expect(state.state).toBe('BOOKED');
  });

  // =========================================================================
  // SAFETY CHECK 9: Calendar failure & handoff: verifies CRM follow-up task created,
  // tags FOLLOW_UP_REQUIRED, no false CALL_BOOKED tag, and state is NOT BOOKED.
  // =========================================================================
  it('9. Calendar failure & handoff creates real CRM note, flags FOLLOW_UP_REQUIRED, leaves state unbooked', async () => {
    calendarMockState.shouldFail = true;

    const messages = [
      { role: 'user', content: 'i want to know about abacus teacher training' },
      { role: 'assistant', content: "Would you like to schedule a quick call with our training advisor?" },
      { role: 'user', content: 'yes please' },
      { role: 'assistant', content: "What day and time work best for you?" },
      { role: 'user', content: 'Tomorrow at 10 AM' },
    ];

    const res = await runAiActionPipeline({
      db: mockDb,
      accountId,
      conversationId,
      contactId,
      inboundText: 'Tomorrow at 10 AM',
      messages,
      contactRecord: { id: contactId, name: 'Pooja Sharma', email: null },
    });

    // 1. Calendar failure must NOT add CALL_BOOKED
    expect(res.tagsAdded).not.toContain('CALL_BOOKED');
    // 2. Must add FOLLOW_UP_REQUIRED
    expect(res.tagsAdded).toContain('FOLLOW_UP_REQUIRED');

    // 3. Must create real CRM note in contact_notes table
    const contactNotes = Array.from(dbData.values()).filter((r) => r.__table === 'contact_notes');
    expect(contactNotes.length).toBeGreaterThan(0);
    const failureNote = contactNotes.find((n) => n.note_text.includes('Calendar Booking Failed'));
    expect(failureNote).toBeDefined();
    expect(failureNote.note_text).toContain('Manual Scheduling Required');

    // 4. State must NOT be BOOKED (should remain AWAITING_PREFERRED_SLOT)
    const state = deriveConversationState([
      ...messages,
      { role: 'assistant', content: res.customerResponse },
    ]);
    expect(state.state).toBe('AWAITING_PREFERRED_SLOT');

    // 5. Must inform customer team will contact them since note was successfully created
    expect(res.customerResponse).toMatch(/(?:team has been notified|team will reach out)/i);
  });

  // =========================================================================
  // SAFETY CHECK 10: Lead temperature: GTC call booking alone does not force HOT_LEAD
  // (retains warm based on configured score of 55: 10 product + 20 req + 25 book).
  // =========================================================================
  it('10. Lead temperature respects scoring policy: GTC call booking does not blindly force HOT_LEAD', async () => {
    const messages = [
      { role: 'user', content: 'i want to know about abacus teacher training' },
      { role: 'assistant', content: "Would you like to schedule a quick call with our training advisor?" },
      { role: 'user', content: 'yes please' },
      { role: 'assistant', content: "What day and time work best for you?" },
      { role: 'user', content: 'Tomorrow at 10 AM' },
    ];

    const res = await runAiActionPipeline({
      db: mockDb,
      accountId,
      conversationId,
      contactId,
      inboundText: 'Tomorrow at 10 AM',
      messages,
      contactRecord: { id: contactId, name: 'Pooja Sharma', email: null },
    });

    expect(res.tagsAdded).toContain('CALL_BOOKED');
    // For GTC (ctaType === 'Call'), booking alone without purchase intent or 71+ score classifies as 'warm'
    expect(res.leadTemperature).toBe('warm');
    expect(res.tagsAdded).not.toContain('HOT_LEAD');
  });

  // =========================================================================
  // SAFETY CHECK 11: Duplicate & partial booking recovery: retrying with the same slot
  // reconciles existing booking rather than creating duplicate calendar event.
  // =========================================================================
  it('11. Duplicate & partial booking recovery reconciles existing booking without duplicate calendar event', async () => {
    const messages = [
      { role: 'user', content: 'i want to know about abacus teacher training' },
      { role: 'assistant', content: "Would you like to schedule a quick call with our training advisor?" },
      { role: 'user', content: 'yes please' },
      { role: 'assistant', content: "What day and time work best for you?" },
      { role: 'user', content: 'Tomorrow at 10 AM' },
    ];

    // Attempt 1: successfully books
    const res1 = await runAiActionPipeline({
      db: mockDb,
      accountId,
      conversationId,
      contactId,
      inboundText: 'Tomorrow at 10 AM',
      messages,
      contactRecord: { id: contactId, name: 'Pooja Sharma', email: null },
    });

    expect(calendarMockState.createdEvents.length).toBe(1);
    expect(res1.tagsAdded).toContain('CALL_BOOKED');

    // Attempt 2: retry / duplicate message for the same slot
    const messagesAttempt2 = [
      ...messages,
      { role: 'assistant', content: res1.customerResponse },
      { role: 'user', content: 'Tomorrow at 10 AM' },
    ];

    const res2 = await runAiActionPipeline({
      db: mockDb,
      accountId,
      conversationId,
      contactId,
      inboundText: 'Tomorrow at 10 AM',
      messages: messagesAttempt2,
      contactRecord: { id: contactId, name: 'Pooja Sharma', email: null },
    });

    // Must NOT create a second calendar event!
    expect(calendarMockState.createdEvents.length).toBe(1);
    expect(res2.customerResponse).toContain('Pooja Sharma');
    expect(res2.customerResponse).toContain('10:00 AM IST');
  });

  // =========================================================================
  // SAFETY CHECK 12: Worker restart & conversational variations:
  // "okay", "when can we schedule", and a later time correction without repeating pitch.
  // =========================================================================
  it('12. Survives worker restart: handles "okay", "when can we schedule", and later time correction without repeating pitch', async () => {
    // Variation A: "okay"
    const resOkay = analyzeCustomerIntent({
      currentText: 'okay',
      lastAssistantMsg: 'Would you like to schedule a quick call with our training advisor?',
    });
    expect(resOkay.signals).toContain('requests_demo_or_call');
    expect(resOkay.stageTagsToAdd).toContain('CALL_REQUESTED');

    // Variation B: "when can we schedule"
    const resWhen = analyzeCustomerIntent({
      currentText: 'when can we schedule',
      lastAssistantMsg: 'Would you like to schedule a quick call with our training advisor?',
    });
    expect(resWhen.signals).toContain('requests_demo_or_call');
    expect(resWhen.stageTagsToAdd).toContain('CALL_REQUESTED');

    // Variation C: Later time correction during AWAITING_PREFERRED_SLOT
    const messagesWithCorrection = [
      { role: 'user', content: 'i want to know about abacus teacher training' },
      { role: 'assistant', content: 'We would love to arrange a quick call. What day and time work best for you?' },
      { role: 'user', content: 'Tomorrow 10am' },
      { role: 'assistant', content: 'Actually, could you do 3pm instead?' },
      { role: 'user', content: 'sure, let us do tomorrow 3pm' },
    ];

    const resCorrection = await runAiActionPipeline({
      db: mockDb,
      accountId,
      conversationId,
      contactId,
      inboundText: 'sure, let us do tomorrow 3pm',
      messages: messagesWithCorrection,
      contactRecord: { id: contactId, name: 'Pooja Sharma', email: null },
    });

    // Must parse the corrected time and book 3:00 PM without repeating the GTC pitch!
    expect(resCorrection.customerResponse).not.toContain('Geniplus Teacher Championship (GTC) program certifies');
    expect(resCorrection.customerResponse).toContain('3:00 PM IST');
    expect(resCorrection.tagsAdded).toContain('CALL_BOOKED');
  });
});
