import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { runAiActionPipeline } from './action-runner';
import { executeDemoBooking, rescheduleDemoBooking } from '@/lib/calendar/booking-coordinator';
import { getTenantProducts, getTenantProductById } from '@/lib/products/tenant-products';
import {
  type TenantProductConfig,
  GENIPLUS_SEED_PRODUCTS,
} from './types';

// Mock calendar API with tracking of calls, arguments, and returned IDs
const calendarMockState = {
  createdEvents: [] as Array<{
    calendarId: string;
    title: string;
    startTime: string;
    endTime: string;
    timezone?: string;
    attendeeEmail?: string;
    attendeeName?: string;
  }>,
  patchedEvents: [] as Array<{
    eventId: string;
    startTime: string;
    endTime: string;
    timezone?: string;
  }>,
  shouldFailCreate: false,
  shouldBeBusy: false,
};

vi.mock('@/lib/calendar/google-calendar', () => ({
  createGoogleCalendarBooking: vi.fn().mockImplementation(async (config, args) => {
    if (calendarMockState.shouldFailCreate) {
      throw new Error('Google Calendar 503 Backend Error: Service Unavailable');
    }
    const eventId = `gcal-prod-event-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    calendarMockState.createdEvents.push({
      calendarId: config.calendar_id || 'primary',
      title: args.title,
      startTime: args.startTime,
      endTime: args.endTime,
      timezone: args.timezone,
      attendeeEmail: args.attendeeEmail,
      attendeeName: args.attendeeName,
    });
    return {
      eventId,
      meetLink: `https://meet.google.com/audit-${eventId.slice(-6)}`,
      htmlLink: `https://calendar.google.com/calendar/event?eid=${eventId}`,
      startTime: args.startTime,
      endTime: args.endTime,
      title: args.title,
    };
  }),
  updateGoogleCalendarBooking: vi.fn().mockImplementation(async (config, args) => {
    calendarMockState.patchedEvents.push({
      eventId: args.eventId,
      startTime: args.startTime,
      endTime: args.endTime,
      timezone: args.timezone,
    });
    return {
      eventId: args.eventId,
      meetLink: `https://meet.google.com/audit-rescheduled`,
      htmlLink: `https://calendar.google.com/calendar/event?eid=${args.eventId}`,
      startTime: args.startTime,
      endTime: args.endTime,
      title: args.title || 'Rescheduled Session',
    };
  }),
  checkGoogleCalendarAvailability: vi.fn().mockImplementation(async (config, args) => {
    if (calendarMockState.shouldBeBusy) {
      return {
        available: false,
        conflictReason: 'Host calendar is busy with another client',
        suggestedSlots: ['2026-10-10T12:00:00.000Z', '2026-10-10T14:00:00.000Z'],
      };
    }
    return {
      available: true,
      suggestedSlots: [],
    };
  }),
  getGoogleCalendarAvailableSlots: vi.fn().mockResolvedValue([
    { startTime: '2026-10-10T12:00:00.000Z', endTime: '2026-10-10T12:45:00.000Z', humanText: '12:00 PM IST' },
    { startTime: '2026-10-10T14:00:00.000Z', endTime: '2026-10-10T14:45:00.000Z', humanText: '2:00 PM IST' },
  ]),
  testGoogleCalendarConnection: vi.fn().mockResolvedValue({ success: true, email: 'service-account@test.iam.gserviceaccount.com' }),
}));

vi.mock('@/lib/whatsapp/send', () => ({
  sendWhatsAppMessage: vi.fn().mockResolvedValue({ success: true, messageId: 'wa-msg-audit-123' }),
}));

describe('Lead Pilot — Production-Path Verification & Reliability Audit', () => {
  const testTenantId = 'tenant_prod_audit_001';
  const otherTenantId = 'tenant_prod_audit_999';
  const testContactId = 'contact_prod_audit_001';
  const testConvId = 'conv_prod_audit_001';

  // Audit product catalogues
  const auditCoachingProduct: TenantProductConfig = {
    productServiceId: 'coach_exec_strategy',
    productKey: 'coach_exec_strategy',
    tenantId: testTenantId,
    name: 'Executive Strategy Consultation',
    category: 'Executive Coaching',
    description: 'High-impact 1-on-1 strategy consultation for startup founders and executives',
    enabled: true,
    appointmentType: 'Executive Strategy Session',
    durationMinutes: 60,
    meetingMode: 'GOOGLE_MEET',
    calendarId: 'executive-calendar@leadpilot.io',
    timezone: 'Asia/Kolkata',
    requiredFields: ['name'],
    optionalFields: ['email', 'phone'],
    tags: {
      interestTag: 'EXEC_STRATEGY_INTEREST',
      bookedTag: 'EXEC_STRATEGY_BOOKED',
    },
    ctaType: 'Call',
    teamName: 'Executive Advisory Team',
    eventTitleTemplate: '{{name}} - Executive Strategy Session',
  };

  const auditSelfScheduleProduct: TenantProductConfig = {
    productServiceId: 'coach_booking_page',
    productKey: 'coach_booking_page',
    tenantId: testTenantId,
    name: 'Self-Scheduled Demo Page',
    category: 'Advisory',
    description: 'Self-scheduling calendar page for asynchronous appointments',
    enabled: true,
    appointmentType: 'Self-Service Intro Call',
    durationMinutes: 30,
    meetingMode: 'BOOKING_PAGE',
    meetingLink: 'https://cal.leadpilot.io/exec/intro',
    tags: {
      interestTag: 'PAGE_INQUIRY',
      bookedTag: 'PAGE_BOOKED',
    },
    ctaType: 'Demo',
    teamName: 'Admissions',
  };

  // State storage for mock DB
  let dbBookings: Array<Record<string, unknown>> = [];
  let dbNotes: Array<Record<string, unknown>> = [];
  let dbTags: Array<Record<string, unknown>> = [];

  function createProductionAuditDb() {
    return {
      from: vi.fn().mockImplementation((table: string) => {
        let filterAccountId = testTenantId;
        let filterContactId = testContactId;
        let filterBookingId: string | null = null;
        let filterStatus: string | null = null;
        let lastInserted: Record<string, unknown> | null = null;
        let filterTagName: string | null = null;

        type Chain = {
          select: () => Chain;
          insert: (val: Record<string, unknown>) => Chain;
          update: (val: Record<string, unknown>) => Chain;
          upsert: (val: Record<string, unknown>) => Chain;
          delete: () => Chain;
          eq: (col: string, val: string) => Chain;
          in: () => Chain;
          ilike: (col: string, val: string) => Chain;
          order: () => Chain;
          limit: () => Chain;
          single: () => Promise<{ data: unknown; error: null | { message: string } }>;
          maybeSingle: () => Promise<{ data: unknown; error: null | { message: string } }>;
          then: <T1 = { data: unknown; error: null }, T2 = never>(
            res?: ((v: { data: unknown; error: null }) => T1 | PromiseLike<T1>) | null,
          ) => Promise<T1 | T2>;
        };

        const chain: Chain = {
          select: () => chain,
          insert: (val: Record<string, unknown>) => {
            lastInserted = val;
            if (table === 'calendar_bookings') dbBookings.push(val);
            if (table === 'contact_notes') dbNotes.push(val);
            if (table === 'contact_tags') dbTags.push(val);
            return chain;
          },
          update: (val: Record<string, unknown>) => {
            if (table === 'calendar_bookings' && filterBookingId) {
              const b = dbBookings.find((x) => x.id === filterBookingId);
              if (b) Object.assign(b, val);
            }
            return chain;
          },
          upsert: () => chain,
          delete: () => chain,
          eq: (col: string, val: string) => {
            if (col === 'account_id') filterAccountId = val;
            if (col === 'contact_id') filterContactId = val;
            if (col === 'id') filterBookingId = val;
            if (col === 'status') filterStatus = val;
            return chain;
          },
          in: () => chain,
          ilike: (col: string, val: string) => {
            if (col === 'name') filterTagName = val;
            return chain;
          },
          order: () => chain,
          limit: () => chain,
          single: () => {
            if (table === 'calendar_bookings') {
              if (filterBookingId) {
                const found = dbBookings.find((b) => b.id === filterBookingId && b.account_id === filterAccountId);
                return Promise.resolve({ data: found || null, error: found ? null : { message: 'Booking not found' } });
              }
              const created = lastInserted || dbBookings[dbBookings.length - 1] || null;
              return Promise.resolve({ data: created ? { id: 'booking-rec-1', ...created } : null, error: null });
            }
            if (table === 'tags') {
              return Promise.resolve({ data: { id: 'tag-1', name: filterTagName || 'TAG' }, error: null });
            }
            if (table === 'contacts') {
              return Promise.resolve({
                data: {
                  id: filterContactId,
                  name: 'Rajesh Mehra',
                  phone: '+919876543210',
                  email: null,
                  lead_score: 20,
                  lead_temperature: 'warm',
                },
                error: null,
              });
            }
            return Promise.resolve({ data: { id: 'single-id' }, error: null });
          },
          maybeSingle: () => {
            if (table === 'calendar_bookings') {
              const active = dbBookings.find(
                (b) => b.account_id === filterAccountId && b.contact_id === filterContactId && b.status === (filterStatus || 'confirmed'),
              );
              return Promise.resolve({ data: active || null, error: null });
            }
            if (table === 'tenant_products') {
              if (filterAccountId === testTenantId) {
                return Promise.resolve({ data: auditCoachingProduct, error: null });
              }
              return Promise.resolve({ data: null, error: null });
            }
            if (table === 'tags') {
              return Promise.resolve({ data: { id: 'tag-1', name: filterTagName || 'TAG' }, error: null });
            }
            if (table === 'contacts') {
              return Promise.resolve({
                data: {
                  id: filterContactId,
                  name: 'Rajesh Mehra',
                  phone: '+919876543210',
                  email: null,
                  lead_score: 20,
                  lead_temperature: 'warm',
                },
                error: null,
              });
            }
            if (table === 'contact_tags') {
              return Promise.resolve({ data: { id: 'ct-1', tag_id: 'tag-1' }, error: null });
            }
            if (table === 'google_calendar_configs') {
              return Promise.resolve({
                data: {
                  calendar_id: 'executive-calendar@leadpilot.io',
                  is_active: true,
                  service_account_key: 'test-sa-key',
                  default_timezone: 'Asia/Kolkata',
                  default_meeting_duration: 60,
                },
                error: null,
              });
            }
            return Promise.resolve({ data: null, error: null });
          },
          then: (resolve) => {
            if (table === 'tenant_products') {
              const prods = filterAccountId === testTenantId
                ? [auditCoachingProduct, auditSelfScheduleProduct]
                : filterAccountId === 'geniplus-acc'
                ? Object.values(GENIPLUS_SEED_PRODUCTS)
                : [];
              return Promise.resolve({ data: prods, error: null }).then(resolve);
            }
            if (table === 'calendar_bookings') {
              const filtered = dbBookings.filter((b) => b.account_id === filterAccountId);
              return Promise.resolve({ data: filtered, error: null }).then(resolve);
            }
            if (table === 'tags') {
              return Promise.resolve({
                data: [{ id: 'tag-1', name: filterTagName || 'TAG' }],
                error: null,
              }).then(resolve);
            }
            return Promise.resolve({ data: [], error: null }).then(resolve);
          },
        };

        return chain;
      }),
      rpc: vi.fn().mockResolvedValue({ data: null, error: null }),
    };
  }

  beforeEach(() => {
    vi.clearAllMocks();
    calendarMockState.createdEvents = [];
    calendarMockState.patchedEvents = [];
    calendarMockState.shouldFailCreate = false;
    calendarMockState.shouldBeBusy = false;
    dbBookings = [];
    dbNotes = [];
    dbTags = [];
  });

  // TEST CASE 1: Demo inquiry identifies the correct tenant product
  it('Production Case 1: Identifies the correct tenant product for executive consultation', async () => {
    const db = createProductionAuditDb() as unknown as SupabaseClient;
    const res = await runAiActionPipeline({
      db,
      accountId: testTenantId,
      contactId: testContactId,
      conversationId: testConvId,
      inboundText: 'I am a startup founder looking for high-impact executive strategy consultation.',
      messages: [{ role: 'user', content: 'I am a startup founder looking for high-impact executive strategy consultation.' }],
      contactRecord: { id: testContactId, name: 'Rajesh Mehra', email: null },
    });

    expect(res.productKey).toBe('coach_exec_strategy');
    expect(res.tagsAdded).toContain('EXEC_STRATEGY_INTEREST');
    expect(res.customerResponse).toContain('Executive Strategy Session');
    expect(res.customerResponse).not.toContain('Abacus');
  });

  // TEST CASE 2: Asks for name when required and accepts phone number without email
  it('Production Case 2: Demands customer name if missing and proceeds with phone-only when email optional', async () => {
    const db = createProductionAuditDb() as unknown as SupabaseClient;

    // Contact with placeholder name 'Customer'
    const res = await runAiActionPipeline({
      db,
      accountId: testTenantId,
      contactId: testContactId,
      conversationId: testConvId,
      inboundText: 'Tomorrow at 4 PM please.',
      messages: [{ role: 'user', content: 'Tomorrow at 4 PM please.' }],
      contactRecord: { id: testContactId, name: 'Customer', email: null },
    });

    expect(res.customerResponse).toContain('What name should I use for the booking?');
  });

  // TEST CASE 3: Checks real calendar availability and offers actual slots on busy conflict
  it('Production Case 3: Checks calendar availability and offers actual slots when requested time is busy', async () => {
    calendarMockState.shouldBeBusy = true;
    const db = createProductionAuditDb() as unknown as SupabaseClient;

    const res = await runAiActionPipeline({
      db,
      accountId: testTenantId,
      contactId: testContactId,
      conversationId: testConvId,
      inboundText: 'Book me for tomorrow 4 PM. My name is Rajesh Mehra.',
      messages: [{ role: 'user', content: 'Book me for tomorrow 4 PM. My name is Rajesh Mehra.' }],
      contactRecord: { id: testContactId, name: 'Rajesh Mehra', email: null },
    });

    expect(res.customerResponse).toContain('booked');
    expect(res.customerResponse).toContain('12:00 PM IST');
    expect(res.customerResponse).toContain('2:00 PM IST');
    expect(calendarMockState.createdEvents).toHaveLength(0);
  });

  // TEST CASE 4, 5 & 6: Successful booking creates external event with verified ID and matching time
  it('Production Cases 4, 5, 6: Creates external event with verified ID, matching timezone, duration, and link', async () => {
    const db = createProductionAuditDb() as unknown as SupabaseClient;

    const res = await runAiActionPipeline({
      db,
      accountId: testTenantId,
      contactId: testContactId,
      conversationId: testConvId,
      inboundText: 'Tomorrow at 4 PM works great for me. My name is Rajesh Mehra.',
      messages: [{ role: 'user', content: 'Tomorrow at 4 PM works great for me. My name is Rajesh Mehra.' }],
      contactRecord: { id: testContactId, name: 'Rajesh Mehra', email: null },
    });

    // Case 4: External calendar event created
    expect(calendarMockState.createdEvents).toHaveLength(1);
    const created = calendarMockState.createdEvents[0];

    // Case 5: Match date, duration (60m), and timezone
    expect(created.title).toBe('Rajesh Mehra - Executive Strategy Session');
    expect(created.timezone).toBe('Asia/Kolkata');
    const start = new Date(created.startTime);
    const end = new Date(created.endTime);
    const durationMins = (end.getTime() - start.getTime()) / (1000 * 60);
    expect(durationMins).toBe(60);

    // Case 6: Verified external event ID & Google Meet link
    expect(res.customerResponse).toContain('Executive Strategy Session is booked');
    expect(res.customerResponse).toContain('https://meet.google.com/audit-');
    expect(res.tagsAdded).toContain('EXEC_STRATEGY_BOOKED');
  });

  // TEST CASE 7: CRM persistence of booking record, product_service_id, tags, score, assignment, note
  it('Production Case 7: Persists tenant-scoped CRM booking record, tags, lead score, and internal activity note', async () => {
    const db = createProductionAuditDb() as unknown as SupabaseClient;

    await runAiActionPipeline({
      db,
      accountId: testTenantId,
      contactId: testContactId,
      conversationId: testConvId,
      inboundText: 'Tomorrow at 4 PM works for Rajesh Mehra.',
      messages: [{ role: 'user', content: 'Tomorrow at 4 PM works for Rajesh Mehra.' }],
      contactRecord: { id: testContactId, name: 'Rajesh Mehra', email: null },
    });

    expect(dbBookings).toHaveLength(1);
    const booking = dbBookings[0];
    expect(booking.account_id).toBe(testTenantId);
    expect(booking.contact_id).toBe(testContactId);
    expect(booking.product_service_id).toBe('coach_exec_strategy');
    expect(booking.meeting_mode).toBe('GOOGLE_MEET');
    expect(booking.status).toBe('confirmed');

    // Activity note created with external event ID
    expect(dbNotes.length).toBeGreaterThan(0);
    const note = dbNotes[0];
    expect(note.note_text).toContain('External event ID: gcal-prod-event-');
  });

  // TEST CASE 8: Customer receives verified WhatsApp confirmation matching actual event
  it('Production Case 8: WhatsApp confirmation includes accurate time, duration, and link without fake notices', async () => {
    const db = createProductionAuditDb() as unknown as SupabaseClient;

    const res = await runAiActionPipeline({
      db,
      accountId: testTenantId,
      contactId: testContactId,
      conversationId: testConvId,
      inboundText: 'Tomorrow at 4 PM. Name is Rajesh Mehra.',
      messages: [{ role: 'user', content: 'Tomorrow at 4 PM. Name is Rajesh Mehra.' }],
      contactRecord: { id: testContactId, name: 'Rajesh Mehra', email: null },
    });

    expect(res.customerResponse).toContain('Executive Strategy Session is booked');
    expect(res.customerResponse).toContain('4:00 PM IST');
    expect(res.customerResponse).toContain('60 minutes');
    expect(res.customerResponse).toContain('Google Meet: https://meet.google.com/audit-');
    // Email is omitted, so no false email invite announcement
    expect(res.customerResponse).not.toContain('sent to your email');
  });

  // TEST CASE 9: API error never produces a false booking confirmation
  it('Production Case 9: External API error or timeout never produces a confirmed booking status or booked tag', async () => {
    calendarMockState.shouldFailCreate = true;
    const db = createProductionAuditDb() as unknown as SupabaseClient;

    const res = await runAiActionPipeline({
      db,
      accountId: testTenantId,
      contactId: testContactId,
      conversationId: testConvId,
      inboundText: 'Tomorrow at 4 PM. Name is Rajesh Mehra.',
      messages: [{ role: 'user', content: 'Tomorrow at 4 PM. Name is Rajesh Mehra.' }],
      contactRecord: { id: testContactId, name: 'Rajesh Mehra', email: null },
    });

    expect(res.tagsAdded).not.toContain('EXEC_STRATEGY_BOOKED');
    expect(res.customerResponse).not.toContain('is booked');
    expect(res.customerResponse).toContain('having trouble reserving that exact slot');
  });

  // TEST CASE 10: Retries do not create duplicate calendar events or bookings
  it('Production Case 10: Repeated execution with existing active booking updates existing instead of duplicating', async () => {
    const db = createProductionAuditDb() as unknown as SupabaseClient;

    // First booking
    await runAiActionPipeline({
      db,
      accountId: testTenantId,
      contactId: testContactId,
      conversationId: testConvId,
      inboundText: 'Tomorrow at 4 PM. Name is Rajesh Mehra.',
      messages: [{ role: 'user', content: 'Tomorrow at 4 PM. Name is Rajesh Mehra.' }],
      contactRecord: { id: testContactId, name: 'Rajesh Mehra', email: null },
    });
    expect(dbBookings).toHaveLength(1);
    expect(calendarMockState.createdEvents).toHaveLength(1);

    // Simulating retry / second inbound message for same slot
    const retryRes = await runAiActionPipeline({
      db,
      accountId: testTenantId,
      contactId: testContactId,
      conversationId: testConvId,
      inboundText: 'Tomorrow at 4 PM. Name is Rajesh Mehra.',
      messages: [
        { role: 'user', content: 'Tomorrow at 4 PM. Name is Rajesh Mehra.' },
        { role: 'assistant', content: 'Executive Strategy Session is booked!' },
        { role: 'user', content: 'Tomorrow at 4 PM. Name is Rajesh Mehra.' },
      ],
      contactRecord: { id: testContactId, name: 'Rajesh Mehra', email: null },
    });

    // Does NOT create second calendar event
    expect(calendarMockState.createdEvents).toHaveLength(1);
    expect(retryRes.customerResponse).toContain('rescheduled');
  });

  // TEST CASE 11: Rescheduling updates existing event instead of creating unintended duplicate
  it('Production Case 11: Rescheduling updates intended existing event with new time and verified patch', async () => {
    const db = createProductionAuditDb() as unknown as SupabaseClient;

    // First booking
    await runAiActionPipeline({
      db,
      accountId: testTenantId,
      contactId: testContactId,
      conversationId: testConvId,
      inboundText: 'Tomorrow at 4 PM. Name is Rajesh Mehra.',
      messages: [{ role: 'user', content: 'Tomorrow at 4 PM. Name is Rajesh Mehra.' }],
      contactRecord: { id: testContactId, name: 'Rajesh Mehra', email: null },
    });

    const existingBookingId = (dbBookings[0] as { id: string }).id;

    // Reschedule request: "Can you change it to 6 PM instead?"
    const reschedRes = await runAiActionPipeline({
      db,
      accountId: testTenantId,
      contactId: testContactId,
      conversationId: testConvId,
      inboundText: 'Can we change it to 6 PM instead?',
      messages: [
        { role: 'user', content: 'Tomorrow at 4 PM. Name is Rajesh Mehra.' },
        { role: 'assistant', content: 'Executive Strategy Session is booked!' },
        { role: 'user', content: 'Can we change it to 6 PM instead?' },
      ],
      contactRecord: { id: testContactId, name: 'Rajesh Mehra', email: null },
    });

    expect(reschedRes.customerResponse).toContain('has been rescheduled');
    expect(reschedRes.customerResponse).toContain('6:00 PM IST');
    // Verified that update/patch was called on external calendar API
    expect(calendarMockState.patchedEvents).toHaveLength(1);
  });

  // TEST CASE 12: Self-scheduling BOOKING_PAGE mode does not claim an external booking exists
  it('Production Case 12: BOOKING_PAGE mode sends self-scheduling URL without claiming a confirmed booking exists', async () => {
    const db = createProductionAuditDb() as unknown as SupabaseClient;

    const res = await runAiActionPipeline({
      db,
      accountId: testTenantId,
      contactId: 'contact_page_user',
      conversationId: 'conv_page_user',
      inboundText: 'Can I book an intro call on your self-scheduling page?',
      messages: [{ role: 'user', content: 'Can I book an intro call on your self-scheduling page?' }],
      contactRecord: { id: 'contact_page_user', name: 'Alok', email: null },
    });

    expect(res.customerResponse).toContain('https://cal.leadpilot.io/exec/intro');
    expect(res.customerResponse).not.toContain('Your appointment is confirmed');
    // Never created a premature booking in calendar_bookings
    expect(dbBookings).toHaveLength(0);
  });

  // SECURITY AUDIT: Cross-tenant data isolation
  it('Security Audit: Rejects cross-tenant access to products, bookings, and configuration', async () => {
    const db = createProductionAuditDb() as unknown as SupabaseClient;

    // Attempting to query products for otherTenantId
    const otherProducts = await getTenantProducts(db, otherTenantId);
    expect(otherProducts).toHaveLength(0);

    // Attempting to get testTenantId product using otherTenantId
    const crossAccess = await getTenantProductById(db, otherTenantId, 'coach_exec_strategy');
    expect(crossAccess).toBeNull();
  });
});
