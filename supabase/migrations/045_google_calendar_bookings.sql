-- ============================================================
-- 045_google_calendar_bookings.sql
--
-- Google Calendar integration & automated demo/call booking
-- for coaches, consultants, and trainers.
-- ============================================================

-- 1. Google Calendar configuration per workspace/account
CREATE TABLE IF NOT EXISTS public.google_calendar_configs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL UNIQUE REFERENCES public.accounts(id) ON DELETE CASCADE,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  calendar_id text NOT NULL DEFAULT 'primary',
  auth_type text NOT NULL DEFAULT 'service_account' CHECK (auth_type IN ('service_account', 'oauth')),
  service_account_key text, -- AES-256-GCM encrypted JSON service account credentials
  oauth_credentials text,   -- AES-256-GCM encrypted OAuth tokens
  is_active boolean NOT NULL DEFAULT false,
  auto_booking_enabled boolean NOT NULL DEFAULT true,
  default_meeting_title text NOT NULL DEFAULT 'LeadPilot Demo Call',
  default_meeting_duration integer NOT NULL DEFAULT 30 CHECK (default_meeting_duration BETWEEN 5 AND 240),
  default_timezone text NOT NULL DEFAULT 'UTC',
  working_hours_start text NOT NULL DEFAULT '09:00',
  working_hours_end text NOT NULL DEFAULT '18:00',
  buffer_between_meetings integer NOT NULL DEFAULT 15,
  confirmation_message_template text DEFAULT '🎉 Great news! Your demo call has been scheduled.\n\n📅 Date & Time: {{date_time}}\n📧 Calendar invite sent to: {{email}}\n📹 Google Meet: {{meet_link}}\n\nWe look forward to speaking with you! Reply here anytime if you need to reschedule.',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- 2. Bookings & Appointments
CREATE TABLE IF NOT EXISTS public.calendar_bookings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  contact_id uuid NOT NULL REFERENCES public.contacts(id) ON DELETE CASCADE,
  conversation_id uuid REFERENCES public.conversations(id) ON DELETE SET NULL,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  booked_by text NOT NULL DEFAULT 'ai' CHECK (booked_by IN ('ai', 'agent', 'flow', 'manual')),
  google_event_id text,
  google_calendar_id text,
  title text NOT NULL,
  description text,
  attendee_email text NOT NULL,
  attendee_name text,
  attendee_phone text,
  start_time timestamptz NOT NULL,
  end_time timestamptz NOT NULL,
  timezone text NOT NULL DEFAULT 'UTC',
  meet_link text,
  html_link text,
  status text NOT NULL DEFAULT 'confirmed' CHECK (status IN ('confirmed', 'cancelled', 'rescheduled')),
  confirmation_sent boolean NOT NULL DEFAULT false,
  confirmation_sent_at timestamptz,
  metadata jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_calendar_bookings_account_start ON public.calendar_bookings(account_id, start_time DESC);
CREATE INDEX IF NOT EXISTS idx_calendar_bookings_contact ON public.calendar_bookings(contact_id);
CREATE INDEX IF NOT EXISTS idx_calendar_bookings_conversation ON public.calendar_bookings(conversation_id);

-- RLS
ALTER TABLE public.google_calendar_configs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.calendar_bookings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS google_calendar_configs_select ON public.google_calendar_configs;
CREATE POLICY google_calendar_configs_select ON public.google_calendar_configs
  FOR SELECT USING (is_account_member(account_id, 'viewer'));

DROP POLICY IF EXISTS google_calendar_configs_all ON public.google_calendar_configs;
CREATE POLICY google_calendar_configs_all ON public.google_calendar_configs
  FOR ALL USING (is_account_member(account_id, 'admin'));

DROP POLICY IF EXISTS calendar_bookings_select ON public.calendar_bookings;
CREATE POLICY calendar_bookings_select ON public.calendar_bookings
  FOR SELECT USING (is_account_member(account_id, 'viewer'));

DROP POLICY IF EXISTS calendar_bookings_all ON public.calendar_bookings;
CREATE POLICY calendar_bookings_all ON public.calendar_bookings
  FOR ALL USING (is_account_member(account_id, 'agent'));

GRANT ALL ON TABLE public.google_calendar_configs TO service_role, authenticated;
GRANT ALL ON TABLE public.calendar_bookings TO service_role, authenticated;
