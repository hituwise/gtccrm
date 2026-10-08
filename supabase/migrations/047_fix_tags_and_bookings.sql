-- Migration 047: Fix tags user_id constraint and enhance calendar bookings integrity
-- Allows backend AI actions to create account-scoped tags without requiring an interactive auth session.

ALTER TABLE IF EXISTS public.tags ALTER COLUMN user_id DROP NOT NULL;

-- Ensure calendar_bookings has proper indexes and status constraints
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'calendar_bookings_status_check'
  ) THEN
    ALTER TABLE public.calendar_bookings
      DROP CONSTRAINT IF EXISTS calendar_bookings_status_check;
    ALTER TABLE public.calendar_bookings
      ADD CONSTRAINT calendar_bookings_status_check
      CHECK (status IN ('pending', 'confirmed', 'cancelled', 'rescheduled', 'failed'));
  END IF;
END $$;

-- Add index on contact_id and status for fast active booking lookups (prevent duplicates & support rescheduling)
CREATE INDEX IF NOT EXISTS idx_calendar_bookings_contact_status
  ON public.calendar_bookings (contact_id, status);

CREATE INDEX IF NOT EXISTS idx_calendar_bookings_account_start
  ON public.calendar_bookings (account_id, start_time);
