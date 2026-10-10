import { NextResponse } from 'next/server';
import {
  getCurrentAccount,
  requireRole,
  toErrorResponse,
} from '@/lib/auth/account';
import { executeDemoBooking } from '@/lib/calendar/booking-coordinator';

/**
 * GET /api/calendar/bookings
 *
 * List calendar bookings for the account, optionally filtered by contactId.
 */
export async function GET(request: Request) {
  try {
    const { supabase, accountId } = await getCurrentAccount();
    const { searchParams } = new URL(request.url);

    const contactId = searchParams.get('contactId');
    const limit = Math.min(100, Math.max(1, Number(searchParams.get('limit')) || 50));

    let query = supabase
      .from('calendar_bookings')
      .select('*, contact:contacts(id, name, phone, email)')
      .eq('account_id', accountId)
      .order('start_time', { ascending: false })
      .limit(limit);

    if (contactId) {
      query = query.eq('contact_id', contactId);
    }

    const { data, error } = await query;

    if (error) {
      if (error.code === '42P01') {
        return NextResponse.json({ bookings: [] });
      }
      console.error('[calendar/bookings GET] error:', error);
      return NextResponse.json(
        { error: 'Failed to fetch bookings' },
        { status: 500 },
      );
    }

    return NextResponse.json({ bookings: data || [] });
  } catch (err) {
    return toErrorResponse(err);
  }
}

/**
 * POST /api/calendar/bookings  (agent+)
 *
 * Manually schedule a demo or call for a contact from the Inbox or CRM.
 */
export async function POST(request: Request) {
  try {
    const { supabase, accountId, userId } = await requireRole('agent');

    const body = await request.json().catch(() => null);
    if (!body || typeof body !== 'object') {
      return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
    }

    const {
      contactId,
      conversationId,
      email,
      startTime,
      title,
      durationMinutes,
      productServiceId,
      meetingMode,
      meetingLink,
      sendConfirmation = true,
    } = body;

    if (!contactId) {
      return NextResponse.json({ error: 'contactId is required' }, { status: 400 });
    }
    if (email && (typeof email !== 'string' || !email.includes('@'))) {
      return NextResponse.json({ error: 'A valid email address is required when email is provided' }, { status: 400 });
    }

    const cleanEmail = email && typeof email === 'string' && email.trim() ? email.trim().toLowerCase() : null;

    const result = await executeDemoBooking({
      db: supabase,
      accountId,
      contactId,
      conversationId,
      configOwnerUserId: userId,
      email: cleanEmail,
      productServiceId,
      meetingMode,
      staticMeetingLink: meetingLink,
      preferredTimeText: startTime,
      bookedBy: 'agent',
      manualTitle: title,
      manualDuration: durationMinutes,
      sendWhatsAppConfirmation: Boolean(sendConfirmation && conversationId),
    });

    return NextResponse.json(result);
  } catch (err) {
    return toErrorResponse(err);
  }
}
