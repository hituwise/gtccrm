import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { runAiActionPipeline } from '@/lib/ai/actions/action-runner';
import { GENIPLUS_SEED_PRODUCTS } from '@/lib/ai/actions/types';
import { dispatchInboundToAiReply } from '@/lib/ai/auto-reply';
import { buildContextualRetrievalQuery } from '@/lib/ai/knowledge';
import { parseBookingSlot, formatBookingDateTime } from '@/lib/calendar/date-parser';
import type { TenantProductConfig } from '@/lib/ai/actions/types';
import * as googleCal from '@/lib/calendar/google-calendar';

// Mock Meta WhatsApp sender
vi.mock('@/lib/flows/meta-send', () => ({
  engineSendText: vi.fn().mockResolvedValue({ whatsapp_message_id: 'wa-msg-replay-1' }),
  loadAccountMetaCredentials: vi.fn().mockResolvedValue({
    accessToken: 'test-token',
    phoneNumberId: '1234567890',
  }),
}));

vi.mock('@/lib/whatsapp/meta-api', () => ({
  sendTypingIndicator: vi.fn().mockResolvedValue(true),
}));

describe('Screenshot Replay End-to-End Tests & Grounding Invariants', () => {
  const accountId = 'geniplus-tenant-acc';
  const contactId = 'contact-replay-101';
  const conversationId = 'conv-replay-101';

  let mockBookings: Array<Record<string, unknown>> = [];
  let mockState: Record<string, unknown> = {};

  const mockDb = {
    from: vi.fn().mockImplementation((table: string) => {
      let filterCol = '';
      let filterVal = '';

      const chain: any = {
        select: vi.fn().mockReturnThis(),
        insert: vi.fn().mockImplementation((val: any) => {
          if (table === 'calendar_bookings') {
            const conflict = mockBookings.find(
              (b: any) =>
                b.account_id === val.account_id &&
                b.contact_id === val.contact_id &&
                b.start_time === val.start_time &&
                (b.product_service_id || '') === (val.product_service_id || ''),
            );
            if (conflict) {
              const err = {
                code: '23505',
                message: 'duplicate key value violates unique constraint "uq_calendar_bookings_exact_slot"',
              };
              const errChain: any = {
                ...chain,
                select: vi.fn().mockImplementation(() => ({
                  ...errChain,
                  single: vi.fn().mockResolvedValue({ data: null, error: err }),
                  maybeSingle: vi.fn().mockResolvedValue({ data: null, error: err }),
                })),
                single: vi.fn().mockResolvedValue({ data: null, error: err }),
                maybeSingle: vi.fn().mockResolvedValue({ data: null, error: err }),
              };
              return errChain;
            }
          }
          const insertedRow = { id: `id-${Date.now()}`, ...val };
          if (table === 'calendar_bookings') {
            mockBookings.push(insertedRow);
          }
          const insertChain: any = {
            ...chain,
            select: vi.fn().mockImplementation(() => ({
              ...insertChain,
              single: vi.fn().mockResolvedValue({ data: insertedRow, error: null }),
              maybeSingle: vi.fn().mockResolvedValue({ data: insertedRow, error: null }),
            })),
            single: vi.fn().mockResolvedValue({ data: insertedRow, error: null }),
            maybeSingle: vi.fn().mockResolvedValue({ data: insertedRow, error: null }),
          };
          return insertChain;
        }),
        update: vi.fn().mockImplementation((val: any) => {
          if (table === 'conversation_state') {
            mockState = { ...mockState, ...val };
          }
          return chain;
        }),
        upsert: vi.fn().mockImplementation((val: any) => {
          if (table === 'conversation_state') {
            mockState = { ...mockState, ...val };
          }
          return chain;
        }),
        delete: vi.fn().mockReturnThis(),
        eq: vi.fn().mockImplementation((col: string, val: string) => {
          filterCol = col;
          filterVal = val;
          return chain;
        }),
        in: vi.fn().mockReturnThis(),
        ilike: vi.fn().mockReturnThis(),
        order: vi.fn().mockReturnThis(),
        limit: vi.fn().mockReturnThis(),
        then: vi.fn().mockImplementation((resolve, reject) => {
          if (table === 'calendar_bookings') {
            return Promise.resolve({ data: mockBookings, error: null }).then(resolve, reject);
          }
          return Promise.resolve({ data: [], error: null }).then(resolve, reject);
        }),
        single: vi.fn().mockImplementation(() => {
          if (table === 'google_calendar_configs') {
            return Promise.resolve({
              data: {
                account_id: accountId,
                is_active: true,
                auto_booking_enabled: true,
                auth_type: 'service_account',
                service_account_key: '{"client_email":"test@service.com","private_key":"key"}',
                calendar_id: 'primary',
                default_timezone: 'Asia/Kolkata',
              },
              error: null,
            });
          }
          if (table === 'tenant_products') {
            return Promise.resolve({ data: Object.values(GENIPLUS_SEED_PRODUCTS), error: null });
          }
          if (table === 'conversations') {
            return Promise.resolve({
              data: { id: conversationId, account_id: accountId, contact_id: contactId, status: 'open' },
              error: null,
            });
          }
          if (table === 'tags') {
            return Promise.resolve({ data: { id: 'tag-1', name: filterVal || 'INTERESTED' }, error: null });
          }
          if (table === 'contacts') {
            return Promise.resolve({
              data: { id: contactId, account_id: accountId, name: 'Customer', email: 'test@example.com' },
              error: null,
            });
          }
          if (table === 'calendar_bookings') {
            return Promise.resolve({ data: mockBookings[mockBookings.length - 1] || null, error: null });
          }
          return Promise.resolve({ data: { id: 'dummy-id' }, error: null });
        }),
        maybeSingle: vi.fn().mockImplementation(() => {
          if (table === 'google_calendar_configs') {
            return Promise.resolve({
              data: {
                account_id: accountId,
                is_active: true,
                auto_booking_enabled: true,
                auth_type: 'service_account',
                service_account_key: '{"client_email":"test@service.com","private_key":"key"}',
                calendar_id: 'primary',
                default_timezone: 'Asia/Kolkata',
              },
              error: null,
            });
          }
          if (table === 'conversation_state') {
            return Promise.resolve({ data: mockState.state ? mockState : null, error: null });
          }
          if (table === 'calendar_bookings') {
            return Promise.resolve({ data: mockBookings[mockBookings.length - 1] || null, error: null });
          }
          if (table === 'tags') {
            return Promise.resolve({ data: { id: 'tag-1', name: filterVal || 'INTERESTED' }, error: null });
          }
          if (table === 'contacts') {
            return Promise.resolve({
              data: { id: contactId, account_id: accountId, name: 'Customer', email: 'test@example.com' },
              error: null,
            });
          }
          if (table === 'contact_tags') {
            return Promise.resolve({ data: { tag_id: 'tag-1', contact_id: contactId }, error: null });
          }
          return Promise.resolve({ data: null, error: null });
        }),
      };
      return chain;
    }),
    rpc: vi.fn().mockImplementation((fnName: string, args: any) => {
      if (fnName === 'acquire_contact_lock') return Promise.resolve({ data: true, error: null });
      if (fnName === 'release_contact_lock') return Promise.resolve({ data: null, error: null });
      if (fnName === 'claim_ai_reply_slot') return Promise.resolve({ data: true, error: null });
      return Promise.resolve({ data: null, error: null });
    }),
  } as unknown as SupabaseClient;

  beforeEach(() => {
    vi.clearAllMocks();
    mockBookings = [];
    mockState = {};

    vi.spyOn(googleCal, 'createGoogleCalendarBooking').mockImplementation(async (_cfg: any, params: any) => ({
      eventId: 'gcal-ev-12345',
      meetLink: 'https://meet.google.com/abc-defg-hij',
      htmlLink: 'https://calendar.google.com/event?eid=123',
      startTime: params.startTime,
      endTime: params.endTime,
      title: params.title,
    }));

    vi.spyOn(googleCal, 'checkGoogleCalendarAvailability').mockResolvedValue({
      available: true,
    });
  });

  // =========================================================================
  // REPLAY 1: Lead Pilot & MAA Conversation Replay from Screenshot
  // Turn 1: User says "Both"
  // Turn 2: User says "Lead pilot"
  // Turn 3: User picks "10 am ist will work", provides "Hitendra" & email
  // =========================================================================
  it('Replay 1: Lead Pilot/MAA inquiry → "Both" → "Lead pilot" → "10 am ist will work" books calendar without repeating choice message', async () => {
    // TURN 1: Customer responds "Both"
    const turn1Input = 'Both';
    const res1 = await runAiActionPipeline({
      db: mockDb,
      accountId,
      conversationId,
      contactId,
      inboundText: turn1Input,
      messages: [
        { role: 'user', content: 'Tell me about your software solutions' },
        { role: 'assistant', content: 'We offer solutions for coaching academy operations and lead automation.' },
        { role: 'user', content: turn1Input },
      ],
      contactRecord: { id: contactId, name: 'Customer', email: null },
    });

    // Golden Assertion 1: Must NOT return the canned "We offer both Lead Pilot and MAA... Which one would you like to explore?"
    expect(res1.customerResponse).not.toContain('Which one would you like to explore');
    expect(res1.customerResponse).not.toContain('We offer both Lead Pilot and MAA');

    // TURN 2: Customer specifies "Lead pilot"
    const turn2Input = 'Lead pilot';
    const res2 = await runAiActionPipeline({
      db: mockDb,
      accountId,
      conversationId,
      contactId,
      inboundText: turn2Input,
      messages: [
        { role: 'user', content: 'Both' },
        { role: 'assistant', content: 'Here is an overview of both systems...' },
        { role: 'user', content: turn2Input },
      ],
      contactRecord: { id: contactId, name: 'Customer', email: null },
    });

    expect(res2.productKey).toBe('LEAD_PILOT');
    expect(res2.tagsAdded).toContain('LEAD_PILOT_INTEREST');
    // Golden Assertion 2: Must NOT repeat the choice message
    expect(res2.customerResponse).not.toContain('Which one would you like to explore');

    // TURN 3: Customer says "10 am ist will work" and gives Name & Email
    const turn3Input = '10 am ist will work, my name is Hitendra, email is hitendra@gmail.com';
    const res3 = await runAiActionPipeline({
      db: mockDb,
      accountId,
      conversationId,
      contactId,
      inboundText: turn3Input,
      messages: [
        { role: 'user', content: 'Lead pilot' },
        { role: 'assistant', content: 'Would you like to schedule a 30-minute Lead Pilot demo tomorrow?' },
        { role: 'user', content: turn3Input },
      ],
      contactRecord: { id: contactId, name: 'Hitendra', email: 'hitendra@gmail.com' },
    });

    // Golden Assertion 3: Booking is created!
    expect(res3.productKey).toBe('LEAD_PILOT');
    expect(res3.tagsAdded).toContain('DEMO_BOOKED');
    expect(res3.calendarResult?.booked).toBe(true);
    expect(res3.customerResponse).toContain('booked');
    expect(res3.customerResponse).toContain('10:00 AM IST');
    expect(res3.customerResponse).toContain('https://meet.google.com/abc-defg-hij');
    // Golden Assertion 4: No choice message repeats
    expect(res3.customerResponse).not.toContain('Which one would you like to explore');
    expect(res3.customerResponse).not.toContain('We offer both');
  });

  // =========================================================================
  // REPLAY 2: GTC Teacher Training Conversation Replay from Screenshot
  // Turn 1: Customer asks "i want to know about abacus teacher training"
  // Turn 2: Customer says "yes please"
  // Turn 3: Customer provides "Tomorrow at 10 AM", "Pooja Sharma", "pooja@example.com"
  // =========================================================================
  it('Replay 2: GTC inquiry → "yes" → slot booking without hardcoded canned pitch', async () => {
    // Turn 1
    const turn1Input = 'i want to know about abacus teacher training';
    const res1 = await runAiActionPipeline({
      db: mockDb,
      accountId,
      conversationId,
      contactId,
      inboundText: turn1Input,
      messages: [{ role: 'user', content: turn1Input }],
      contactRecord: { id: contactId, name: 'Pooja Sharma', email: null },
    });

    expect(res1.productKey).toBe('GTC');
    expect(res1.tagsAdded).toContain('GTC_INTEREST');
    // Golden Assertion: Hardcoded marketing pitch is NOT present!
    expect(res1.customerResponse).not.toContain('equips you with complete training and certification');

    // Turn 2: "yes" — Contextual retrieval query test
    const contextualQuery = buildContextualRetrievalQuery({
      latestUserText: 'yes',
      messages: [
        { role: 'user', content: turn1Input },
        { role: 'assistant', content: 'Would you like to schedule a 30-minute GTC Training call?' },
        { role: 'user', content: 'yes' },
      ],
      currentTopic: 'GTC',
      selectedProducts: ['GTC'],
    });

    expect(contextualQuery).toContain('GTC');
    expect(contextualQuery).toContain('teacher training');

    // Turn 3: Booking
    const turn3Input = 'Tomorrow at 10 AM, Pooja Sharma, pooja@example.com';
    const res3 = await runAiActionPipeline({
      db: mockDb,
      accountId,
      conversationId,
      contactId,
      inboundText: turn3Input,
      messages: [
        { role: 'user', content: turn1Input },
        { role: 'assistant', content: 'What day and time work best for you?' },
        { role: 'user', content: turn3Input },
      ],
      contactRecord: { id: contactId, name: 'Pooja Sharma', email: 'pooja@example.com' },
    });

    expect(res3.productKey).toBe('GTC');
    expect(res3.tagsAdded).toContain('CALL_BOOKED');
    expect(res3.calendarResult?.booked).toBe(true);
    expect(res3.customerResponse).toContain('booked');
    expect(res3.customerResponse).toContain('10:00 AM IST');
    expect(res3.customerResponse).not.toContain('equips you with complete training');
  });

  // =========================================================================
  // REPLAY 3: Date Bug Replay Test (Addressing Item 4)
  // When a slot is booked, alternative is offered on next day with explicit date,
  // and picking that slot locks the exact ISO date without shifting.
  // =========================================================================
  it('Replay 3: Date bug verification: slot conflict explicitly names the booked date and does not shift the selected alternative date', async () => {
    // Fixed reference date: Wednesday Oct 14, 2026 at 12:00 PM IST
    const fixedReferenceDate = new Date('2026-10-14T12:00:00+05:30');

    // Slot 1: "Tomorrow at 10 AM" parses to Thursday Oct 15, 2026 at 10:00 AM IST
    const slot1 = parseBookingSlot('Tomorrow at 10 AM', 30, fixedReferenceDate, 'Asia/Kolkata');
    expect(slot1.startTime).toBe('2026-10-15T04:30:00.000Z');
    expect(slot1.humanText).toContain('Thursday, Oct 15, 2026 at 10:00 AM IST');

    // Simulate Google Calendar returning conflict for Thursday Oct 15 at 10 AM
    vi.spyOn(googleCal, 'checkGoogleCalendarAvailability').mockResolvedValueOnce({
      available: false,
      conflictReason: 'Busy with another student',
    });

    // Mock Google Calendar finding alternative slot on Friday Oct 16 at 10 AM IST
    vi.spyOn(googleCal, 'getGoogleCalendarAvailableSlots').mockResolvedValueOnce([
      {
        startTime: '2026-10-16T04:30:00.000Z',
        endTime: '2026-10-16T05:00:00.000Z',
        humanText: 'Fri, Oct 16 at 10:00 AM IST',
      },
    ]);

    const res = await runAiActionPipeline({
      db: mockDb,
      accountId,
      conversationId,
      contactId,
      inboundText: 'Tomorrow at 10 AM',
      messages: [{ role: 'user', content: 'Tomorrow at 10 AM' }],
      contactRecord: { id: contactId, name: 'Hitendra', email: 'hitendra@example.com' },
      referenceDate: fixedReferenceDate,
    });

    // Verification: Conflict message explicitly names the booked day (Thursday, Oct 15)
    // so the customer knows Friday Oct 16 is for the next day, not a contradiction!
    expect(res.customerResponse).toContain('Thursday, Oct 15, 2026 at 10:00 AM IST is unfortunately booked');
    expect(res.customerResponse).toContain('Fri, Oct 16 at 10:00 AM IST');

    // Next Turn: User selects "Fri, Oct 16 at 10:00 AM IST"
    const acceptSlot = parseBookingSlot('2026-10-16T04:30:00.000Z', 30, fixedReferenceDate, 'Asia/Kolkata');
    expect(acceptSlot.startTime).toBe('2026-10-16T04:30:00.000Z');
    expect(acceptSlot.humanText).toContain('Friday, Oct 16, 2026 at 10:00 AM IST');
  });

  // =========================================================================
  // REPLAY 4: Multilingual Hindi / Gujarati / Hinglish Intent Detection (Addressing Item 8)
  // =========================================================================
  it('Replay 4: Multilingual intent matching handles Hindi, Gujarati, Hinglish and rejects unrelated franchise queries', async () => {
    const products: TenantProductConfig[] = [
      {
        ...GENIPLUS_SEED_PRODUCTS.LEAD_PILOT,
        aliases: ['lead automation', 'crm demo', 'software ka demo', 'leads ni system'],
      },
      {
        ...GENIPLUS_SEED_PRODUCTS.GTC,
        aliases: ['teacher banna hai', 'shuru karni hai', 'classes shikhvu chhe'],
      },
      {
        ...GENIPLUS_SEED_PRODUCTS.MAA,
        aliases: ['academy management software', 'student fee software'],
        negativeKeywords: ['franchise', 'franchisee'],
      },
    ];

    // Hinglish query
    const hinglishRes = await runAiActionPipeline({
      db: mockDb,
      accountId,
      conversationId,
      contactId,
      productConfigs: products,
      inboundText: 'Mujhe Lead Pilot software ka demo chahiye kal 5 baje',
      messages: [{ role: 'user', content: 'Mujhe Lead Pilot software ka demo chahiye kal 5 baje' }],
      contactRecord: { id: contactId, name: 'Sanjay' },
    });
    expect(hinglishRes.productKey).toBe('LEAD_PILOT');

    // Gujarati query
    const gujaratiRes = await runAiActionPipeline({
      db: mockDb,
      accountId,
      conversationId,
      contactId,
      productConfigs: products,
      inboundText: 'Mane abacus teacher banna hai ane classes shikhvu chhe',
      messages: [{ role: 'user', content: 'Mane abacus teacher banna hai ane classes shikhvu chhe' }],
      contactRecord: { id: contactId, name: 'Bhavna' },
    });
    expect(gujaratiRes.productKey).toBe('GTC');

    // Franchise query when academy software has negativeKeywords: ['franchise']
    // Proves franchise query does NOT match MAA via generic tenant negative keywords (no code special-casing)
    const franchiseRes = await runAiActionPipeline({
      db: mockDb,
      accountId,
      conversationId,
      contactId,
      productConfigs: products,
      inboundText: 'Do you offer a franchise opportunity for an abacus academy?',
      messages: [{ role: 'user', content: 'Do you offer a franchise opportunity for an abacus academy?' }],
      contactRecord: { id: contactId, name: 'Kiran' },
    });
    expect(franchiseRes.productKey).not.toBe('MAA');

    // Positive proof: When a tenant configures a legitimate Franchise product,
    // the exact same generic matching engine matches it without any code special-casing
    const franchiseCatalogue: TenantProductConfig[] = [
      ...products,
      {
        productServiceId: 'FRANCHISE_OPPORTUNITY',
        productKey: 'FRANCHISE_OPPORTUNITY',
        name: 'Abacus Academy Franchise',
        description: 'Franchise partnership and center setup program',
        appointmentType: 'Franchise Discovery Call',
        durationMinutes: 45,
        keywords: ['franchise opportunity', 'franchise', 'open branch', 'franchisee'],
      },
    ];

    const franchiseMatchRes = await runAiActionPipeline({
      db: mockDb,
      accountId,
      conversationId,
      contactId,
      productConfigs: franchiseCatalogue,
      inboundText: 'Do you offer a franchise opportunity for an abacus academy?',
      messages: [{ role: 'user', content: 'Do you offer a franchise opportunity for an abacus academy?' }],
      contactRecord: { id: contactId, name: 'Kiran' },
    });
    expect(franchiseMatchRes.productKey).toBe('FRANCHISE_OPPORTUNITY');
  });

  // =========================================================================
  // REPLAY 5: Concurrent Double Booking Idempotency
  // =========================================================================
  it('Replay 5: Concurrent double booking for contact + product + exact slot creates only 1 booking and 1 calendar event', async () => {
    mockBookings = [];
    mockState = {};

    const slotText = 'Tomorrow at 11:00 AM';
    // Simulate two concurrent webhook requests arriving simultaneously for the same contact, product, and exact slot
    const [resA, resB] = await Promise.all([
      runAiActionPipeline({
        db: mockDb,
        accountId,
        conversationId,
        contactId,
        inboundText: `Book Lead Pilot demo for ${slotText}`,
        messages: [{ role: 'user', content: `Book Lead Pilot demo for ${slotText}` }],
        contactRecord: { id: contactId, name: 'Vikram', email: 'vikram@example.com' },
        referenceDate: new Date('2026-10-15T09:00:00.000Z'),
      }),
      runAiActionPipeline({
        db: mockDb,
        accountId,
        conversationId,
        contactId,
        inboundText: `Book Lead Pilot demo for ${slotText}`,
        messages: [{ role: 'user', content: `Book Lead Pilot demo for ${slotText}` }],
        contactRecord: { id: contactId, name: 'Vikram', email: 'vikram@example.com' },
        referenceDate: new Date('2026-10-15T09:00:00.000Z'),
      }),
    ]);

    expect(resA.calendarResult?.success).toBe(true);
    expect(resB.calendarResult?.success).toBe(true);

    // Both results return the identical Meet link and confirmation
    expect(resA.calendarResult?.meetLink).toBeTruthy();
    expect(resA.calendarResult?.meetLink).toBe(resB.calendarResult?.meetLink);

    // Assert that exactly ONE confirmed booking row exists for this slot
    const exactBookings = mockBookings.filter(
      (b) =>
        b.contact_id === contactId &&
        (b.product_service_id === 'LEAD_PILOT' || b.product_key === 'LEAD_PILOT') &&
        b.status === 'confirmed',
    );
    expect(exactBookings.length).toBe(1);
  });
});

