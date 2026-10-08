import { NextResponse } from 'next/server';
import { requireRole, toErrorResponse } from '@/lib/auth/account';
import {
  cancelGoogleCalendarBooking,
} from '@/lib/calendar/google-calendar';
import { loadCalendarConfig } from '@/lib/calendar/booking-coordinator';

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { supabase, accountId } = await requireRole('agent');
    const { id } = await params;

    // 1. Fetch booking
    const { data: booking, error: fetchErr } = await supabase
      .from('calendar_bookings')
      .select('*')
      .eq('id', id)
      .eq('account_id', accountId)
      .maybeSingle();

    if (fetchErr || !booking) {
      return NextResponse.json({ error: 'Booking not found' }, { status: 404 });
    }

    // 2. If it has a Google Calendar event ID, attempt cancellation on Google
    if (booking.google_event_id) {
      const calConfig = await loadCalendarConfig(supabase, accountId);
      if (calConfig) {
        try {
          await cancelGoogleCalendarBooking(calConfig, booking.google_event_id);
        } catch (calErr) {
          console.warn('[calendar/bookings DELETE] cancelGoogleCalendarBooking failed:', calErr);
        }
      }
    }

    // 3. Mark booking as cancelled in DB
    const { error: updateErr } = await supabase
      .from('calendar_bookings')
      .update({
        status: 'cancelled',
        updated_at: new Date().toISOString(),
      })
      .eq('id', id);

    if (updateErr) {
      console.error('[calendar/bookings DELETE] update error:', updateErr);
      return NextResponse.json({ error: 'Failed to cancel booking' }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    return toErrorResponse(err);
  }
}
