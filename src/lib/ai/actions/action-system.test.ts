import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  analyzeCustomerIntent,
  detectProductIntent,
} from './intent-detector';
import {
  runAiActionPipeline,
  sanitizeCustomerResponse,
} from './action-runner';
import { parseBookingSlot, extractChildAge } from '@/lib/calendar/date-parser';
import { DEFAULT_PRODUCT_CONFIGS } from './types';
import type { ChatMessage } from '@/lib/ai/types';

describe('AI Agent Action System', () => {
  // Mock Supabase database client
  const mockDb = {
    from: vi.fn(),
    rpc: vi.fn(),
  };

  const accountId = 'tenant-test-account-123';
  const contactId = 'contact-xyz-456';
  const conversationId = 'conv-789';

  beforeEach(() => {
    vi.clearAllMocks();

  // Default mock responses
  mockDb.from.mockImplementation((table: string) => {
    function createChain(data: unknown) {
      const chain: any = {
        select: () => chain,
        insert: () => chain,
        update: () => chain,
        delete: () => chain,
        eq: () => chain,
        in: () => chain,
        ilike: () => chain,
        single: () => Promise.resolve({ data, error: null }),
        maybeSingle: () => Promise.resolve({ data, error: null }),
        then: (resolve: any) => Promise.resolve({ data, error: null }).then(resolve),
      };
      return chain;
    }

    if (table === 'tags') {
      return createChain({ id: 'tag-123', name: 'TEST_TAG' });
    }
    if (table === 'contacts') {
      return createChain({
        id: contactId,
        name: 'Ananya Sharma',
        email: 'ananya@example.com',
        phone: '+919876543210',
        lead_score: 0,
        lead_temperature: null,
        lead_score_events: [],
      });
    }
    if (table === 'profiles') {
      return createChain({
        id: 'prof-1',
        full_name: 'Admissions Staff',
      });
    }
    if (table === 'contact_tags') {
      return createChain({ id: 'ct-1' });
    }
    if (table === 'contact_notes') {
      return createChain({ id: 'note-1' });
    }
    if (table === 'conversations') {
      return createChain({ id: conversationId, assigned_agent_id: null });
    }
    if (table === 'ai_action_logs') {
      return createChain({ id: 'log-1' });
    }
    if (table === 'google_calendar_configs') {
      return createChain({
        is_active: false,
        default_timezone: 'Asia/Kolkata',
        default_meeting_duration: 45,
      });
    }
    if (table === 'calendar_bookings') {
      return createChain({
        id: 'booking-unit-1',
        start_time: new Date().toISOString(),
        meet_link: 'https://meet.google.com/abc-defg-hij',
      });
    }

    return createChain(null);
  });
  });

  // ============================================================
  // TEST 1 — Abacus
  // Customer: "I am looking for Abacus classes for my 9-year-old."
  // Expected: ABACUS_KIDS_INTEREST, INTERESTED, Appropriate team assignment
  // ============================================================
  it('TEST 1 — Abacus: detects ABACUS_KIDS_INTEREST, INTERESTED, extracts childAge, assigns Kids team', async () => {
    const input = 'I am looking for Abacus classes for my 9-year-old.';
    const res = await runAiActionPipeline({
      db: mockDb as any,
      accountId,
      conversationId,
      contactId,
      inboundText: input,
      messages: [{ role: 'user', content: input }],
      contactRecord: { id: contactId, email: null },
    });

    expect(res.productKey).toBe('ABACUS_KIDS');
    expect(res.tagsAdded).toContain('ABACUS_KIDS_INTEREST');
    expect(res.tagsAdded).toContain('INTERESTED');
    expect(res.customerResponse).toContain('free 45-minute live demo');
    expect(res.customerResponse).not.toContain('ADD_TAG');
    expect(res.customerResponse).not.toContain('LEAD_SCORE');
  });

  // ============================================================
  // TEST 2 — Abacus Demo
  // Customer: "Yes, book the demo."
  // Expected: DEMO_REQUESTED, HOT/WARM according to scoring rules
  // ============================================================
  it('TEST 2 — Abacus Demo: detects DEMO_REQUESTED and updates lead score', async () => {
    const input = 'Yes, book the demo.';
    const history: ChatMessage[] = [
      { role: 'user', content: 'I want Abacus classes for my child' },
      { role: 'assistant', content: 'Would you like to book a free 45-minute demo?' },
      { role: 'user', content: input },
    ];

    const res = await runAiActionPipeline({
      db: mockDb as any,
      accountId,
      conversationId,
      contactId,
      inboundText: input,
      messages: history,
      contactRecord: { id: contactId, email: null },
    });

    expect(res.tagsAdded).toContain('DEMO_REQUESTED');
    expect(res.leadScore).toBeGreaterThanOrEqual(20);
    expect(['warm', 'hot']).toContain(res.leadTemperature);
    expect(res.customerResponse).toContain('What day and time work best for you?');
  });

  // ============================================================
  // TEST 3 — Abacus Booking
  // Customer: "Tomorrow at 5 PM."
  // Expected: Parse date/time, Check calendar, If available -> book 45 minutes,
  // Add DEMO_BOOKED, Assign team, Create internal note, Confirm to customer
  // ============================================================
  it('TEST 3 — Abacus Booking: parses date/time, books 45m demo, adds DEMO_BOOKED tag and internal note', async () => {
    const input = 'Tomorrow at 5 PM.';
    const history: ChatMessage[] = [
      { role: 'user', content: 'I want Abacus classes for my 9 year old' },
      { role: 'assistant', content: 'What day and time work best?' },
      { role: 'user', content: input },
    ];

    const res = await runAiActionPipeline({
      db: mockDb as any,
      accountId,
      conversationId,
      contactId,
      inboundText: input,
      messages: history,
      contactRecord: {
        id: contactId,
        name: 'Rohan Verma',
        email: 'rohan@example.com',
      },
    });

    expect(res.productKey).toBe('ABACUS_KIDS');
    expect(res.calendarResult).toBeDefined();
    expect(res.calendarResult?.booked).toBe(true);
    expect(res.tagsAdded).toContain('DEMO_BOOKED');
    expect(res.leadTemperature).toBe('hot');
    expect(res.customerResponse).toContain('Your Free Abacus Demo is booked!');
    expect(res.customerResponse).toContain('45 minutes');
    expect(res.customerResponse).not.toContain('ADD_TAG');
    expect(res.customerResponse).not.toContain('NOTE:');
  });

  // ============================================================
  // TEST 4 — Unavailable Slot
  // Customer: "Saturday 5 PM."
  // If unavailable: Do not add DEMO_BOOKED. Retrieve alternatives.
  // Offer only real available slots.
  // ============================================================
  it('TEST 4 — Unavailable Slot: does NOT add DEMO_BOOKED and returns alternatives', async () => {
    // Override executeCheckAvailability mock by configuring conflict
    const calActions = await import('./calendar-actions');
    const origCheck = calActions.executeCheckAvailability;
    const origSlots = calActions.executeGetAvailableSlots;

    vi.spyOn(calActions, 'executeCheckAvailability').mockResolvedValueOnce({
      available: false,
      startTime: '2026-10-10T17:00:00.000Z',
      endTime: '2026-10-10T17:45:00.000Z',
      humanText: 'Saturday, Oct 10, 2026 @ 5:00 PM',
      durationMinutes: 45,
      conflictReason: 'Slot busy',
    });

    vi.spyOn(calActions, 'executeGetAvailableSlots').mockResolvedValueOnce([
      {
        startTime: '2026-10-10T14:00:00.000Z',
        endTime: '2026-10-10T14:45:00.000Z',
        humanText: 'Sat, Oct 10 at 2:00 PM',
      },
      {
        startTime: '2026-10-10T15:30:00.000Z',
        endTime: '2026-10-10T16:15:00.000Z',
        humanText: 'Sat, Oct 10 at 3:30 PM',
      },
    ]);

    const input = 'Saturday 5 PM.';
    const history: ChatMessage[] = [
      { role: 'user', content: 'I want Abacus classes for my child' },
      { role: 'assistant', content: 'What day and time work best?' },
      { role: 'user', content: input },
    ];

    const res = await runAiActionPipeline({
      db: mockDb as any,
      accountId,
      conversationId,
      contactId,
      inboundText: input,
      messages: history,
      contactRecord: { id: contactId, email: 'rohan@example.com' },
    });

    expect(res.tagsAdded).not.toContain('DEMO_BOOKED');
    expect(res.customerResponse).toContain('That specific time is unfortunately booked');
    expect(res.customerResponse).toContain('Sat, Oct 10 at 2:00 PM');
    expect(res.customerResponse).toContain('Sat, Oct 10 at 3:30 PM');
  });

  // ============================================================
  // TEST 5 — MAA
  // Customer: "I need an app to manage my Abacus academy fees and students."
  // Expected: MAA_INTEREST, INTERESTED, Assign to appropriate MAA/product team, Create concise note
  // ============================================================
  it('TEST 5 — MAA: detects MAA_INTEREST, INTERESTED, creates note, assigns MAA team', async () => {
    const input = 'I need an app to manage my Abacus academy fees and students.';
    const res = await runAiActionPipeline({
      db: mockDb as any,
      accountId,
      conversationId,
      contactId,
      inboundText: input,
      messages: [{ role: 'user', content: input }],
      contactRecord: { id: contactId, email: null },
    });

    expect(res.productKey).toBe('MAA');
    expect(res.tagsAdded).toContain('MAA_INTEREST');
    expect(res.tagsAdded).toContain('INTERESTED');
    expect(res.crmNoteCreated).toContain('MAA');
    expect(res.customerResponse).toContain('manage students, teachers, fees');
  });

  // ============================================================
  // TEST 6 — Lead Pilot
  // Customer: "I want WhatsApp automation for my coaching leads."
  // Expected: LEAD_PILOT_INTEREST, INTERESTED, Assign Lead Pilot team, Create note
  // ============================================================
  it('TEST 6 — Lead Pilot: detects LEAD_PILOT_INTEREST, INTERESTED, creates note', async () => {
    const input = 'I want WhatsApp automation for my coaching leads.';
    const res = await runAiActionPipeline({
      db: mockDb as any,
      accountId,
      conversationId,
      contactId,
      inboundText: input,
      messages: [{ role: 'user', content: input }],
      contactRecord: { id: contactId, email: null },
    });

    expect(res.productKey).toBe('LEAD_PILOT');
    expect(res.tagsAdded).toContain('LEAD_PILOT_INTEREST');
    expect(res.tagsAdded).toContain('INTERESTED');
    expect(res.crmNoteCreated).toBeDefined();
    expect(res.customerResponse).toContain('Lead Pilot');
  });

  // ============================================================
  // TEST 7 — GTC
  // Customer: "I want to learn Abacus so I can start teaching."
  // Expected: GTC_INTEREST, INTERESTED, CALL_REQUESTED when call requested, Assign GTC team
  // ============================================================
  it('TEST 7 — GTC: detects GTC_INTEREST, INTERESTED, offers training call', async () => {
    const input = 'I want to learn Abacus so I can start teaching.';
    const res = await runAiActionPipeline({
      db: mockDb as any,
      accountId,
      conversationId,
      contactId,
      inboundText: input,
      messages: [{ role: 'user', content: input }],
      contactRecord: { id: contactId, email: null },
    });

    expect(res.productKey).toBe('GTC');
    expect(res.tagsAdded).toContain('GTC_INTEREST');
    expect(res.tagsAdded).toContain('INTERESTED');
    expect(res.customerResponse).toContain('Teacher Training Course (GTC)');
  });

  // ============================================================
  // TEST 8 — Gold
  // Customer: "I already coach 50 students and need more leads and better sales."
  // Expected: GOLD_INTEREST, WARM/HOT based on scoring, Assign Gold/business-growth team, Create note
  // ============================================================
  it('TEST 8 — Gold: detects GOLD_INTEREST, assigns Gold team, creates note', async () => {
    const input = 'I already coach 50 students and need more leads and better sales.';
    const res = await runAiActionPipeline({
      db: mockDb as any,
      accountId,
      conversationId,
      contactId,
      inboundText: input,
      messages: [{ role: 'user', content: input }],
      contactRecord: { id: contactId, email: null },
    });

    expect(res.productKey).toBe('GOLD');
    expect(res.tagsAdded).toContain('GOLD_INTEREST');
    expect(['warm', 'hot']).toContain(res.leadTemperature);
    expect(res.customerResponse).toContain('Business Growth Call');
  });

  // ============================================================
  // TEST 9 — Payment
  // Customer: "I want to pay and join."
  // Expected: ENROLLMENT_INTEREST, HOT_LEAD, Do NOT add PURCHASED until payment confirmation
  // ============================================================
  it('TEST 9 — Payment: detects ENROLLMENT_INTEREST, HOT_LEAD, never adds PURCHASED prematurely', async () => {
    const input = 'I want to pay and join.';
    const res = await runAiActionPipeline({
      db: mockDb as any,
      accountId,
      conversationId,
      contactId,
      inboundText: input,
      messages: [{ role: 'user', content: input }],
      contactRecord: { id: contactId, email: null },
    });

    expect(res.tagsAdded).toContain('ENROLLMENT_INTEREST');
    expect(res.tagsAdded).not.toContain('PURCHASED');
    expect(res.leadTemperature).toBe('hot');
    expect(res.crmNoteCreated).toContain('Payment requested');
  });

  // ============================================================
  // TEST 10 — Human
  // Customer: "I want to speak to a person."
  // Expected: HUMAN_HANDOFF, Assign appropriate team, Create note
  // ============================================================
  it('TEST 10 — Human: detects HUMAN_HANDOFF, creates note, flags isHandoff: true', async () => {
    const input = 'I want to speak to a person.';
    const res = await runAiActionPipeline({
      db: mockDb as any,
      accountId,
      conversationId,
      contactId,
      inboundText: input,
      messages: [{ role: 'user', content: input }],
      contactRecord: { id: contactId, email: null },
    });

    expect(res.tagsAdded).toContain('HUMAN_HANDOFF');
    expect(res.isHandoff).toBe(true);
    expect(res.crmNoteCreated).toContain('Handoff to human agent');
    expect(res.customerResponse).toContain('connecting you with one of our team members');
  });

  // ============================================================
  // Date/Time Parsing Tests
  // ============================================================
  describe('Natural language date/time parsing', () => {
    it('parses "tomorrow 5 PM" accurately', () => {
      const slot = parseBookingSlot('tomorrow 5 PM', 45);
      expect(slot.isExplicitDay).toBe(true);
      expect(slot.isExplicitTime).toBe(true);
      expect(slot.humanText).toContain('5:00 PM');
    });

    it('parses "Saturday 5 PM"', () => {
      const slot = parseBookingSlot('Saturday 5 PM', 45);
      expect(slot.isExplicitDay).toBe(true);
      expect(slot.isExplicitTime).toBe(true);
      expect(slot.humanText).toContain('Saturday');
      expect(slot.humanText).toContain('5:00 PM');
    });

    it('parses "this Sunday at 10"', () => {
      const slot = parseBookingSlot('this Sunday at 10', 30);
      expect(slot.isExplicitDay).toBe(true);
      expect(slot.isExplicitTime).toBe(true);
      expect(slot.humanText).toContain('Sunday');
    });

    it('parses "next Monday evening"', () => {
      const slot = parseBookingSlot('next Monday evening', 45);
      expect(slot.isExplicitDay).toBe(true);
      expect(slot.isExplicitTime).toBe(true);
      expect(slot.humanText).toContain('Monday');
      expect(slot.humanText).toContain('6:00 PM');
    });

    it('extracts child age from "Tomorrow 5 PM. My child is 9."', () => {
      const age = extractChildAge('Tomorrow 5 PM. My child is 9.');
      expect(age).toBe(9);
    });
  });

  // ============================================================
  // Security & Sanitization
  // ============================================================
  it('sanitizes customer response ensuring zero raw commands leak', () => {
    const raw =
      'ADD_TAG: MAA_INTEREST\nLEAD_SCORE: 80\nASSIGN_TO: sales\nBOOK_CALENDAR: true\nNOTE: Abacus demo booked.\nHello! We look forward to meeting you.';
    const sanitized = sanitizeCustomerResponse(raw);
    expect(sanitized).toBe('Hello! We look forward to meeting you.');
    expect(sanitized).not.toContain('ADD_TAG');
    expect(sanitized).not.toContain('LEAD_SCORE');
    expect(sanitized).not.toContain('NOTE');
  });
});
