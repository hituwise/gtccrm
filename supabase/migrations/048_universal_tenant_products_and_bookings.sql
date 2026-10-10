-- ============================================================
-- Migration 048: Universal Multi-Tenant Product, Service & Booking Architecture
--
-- Enables any coach, trainer, educator, consultant, or business
-- to define their own products, services, meeting modes, and booking rules.
-- Makes email optional for booking and scopes all catalogues to the tenant.
-- ============================================================

-- 1. Make attendee_email optional in calendar_bookings to support phone/WhatsApp-first booking
ALTER TABLE IF EXISTS public.calendar_bookings
  ALTER COLUMN attendee_email DROP NOT NULL;

-- 2. Add product_service_id and meeting_mode to calendar_bookings
-- meeting_mode does NOT carry a blanket DEFAULT 'GOOGLE_MEET'; the application coordinator
-- explicitly persists the product's actual configured mode (GOOGLE_MEET, ZOOM, NONE, etc.)
ALTER TABLE IF EXISTS public.calendar_bookings
  ADD COLUMN IF NOT EXISTS product_service_id text,
  ADD COLUMN IF NOT EXISTS meeting_mode text;

-- Classify any historical rows: if a meet link exists, mark as GOOGLE_MEET; otherwise NONE
UPDATE public.calendar_bookings
SET meeting_mode = CASE
  WHEN meet_link IS NOT NULL AND meet_link <> '' THEN 'GOOGLE_MEET'
  ELSE 'NONE'
END
WHERE meeting_mode IS NULL;

-- 3. Tenant Business Profile columns on accounts
ALTER TABLE IF EXISTS public.accounts
  ADD COLUMN IF NOT EXISTS default_timezone text DEFAULT 'Asia/Kolkata',
  ADD COLUMN IF NOT EXISTS business_description text,
  ADD COLUMN IF NOT EXISTS contact_phone text,
  ADD COLUMN IF NOT EXISTS contact_email text;

-- 4. Extend ai_configs with business_profile
ALTER TABLE IF EXISTS public.ai_configs
  ADD COLUMN IF NOT EXISTS business_profile jsonb DEFAULT '{}'::jsonb;

-- 5. Dynamic Tenant Products & Services Table
CREATE TABLE IF NOT EXISTS public.tenant_products (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  product_service_id text NOT NULL,
  name text NOT NULL,
  description text,
  category text,
  enabled boolean NOT NULL DEFAULT true,
  appointment_type text NOT NULL,
  duration_minutes integer NOT NULL DEFAULT 30 CHECK (duration_minutes BETWEEN 5 AND 480),
  required_fields jsonb NOT NULL DEFAULT '["name", "date", "time"]'::jsonb,
  optional_fields jsonb NOT NULL DEFAULT '["email", "notes"]'::jsonb,
  meeting_mode text NOT NULL CHECK (meeting_mode IN ('GOOGLE_MEET', 'ZOOM', 'STATIC_MEETING_LINK', 'BOOKING_PAGE', 'NONE')),
  meeting_link text,
  calendar_id text DEFAULT 'primary',
  timezone text,
  event_title_template text,
  confirmation_template text,
  tags jsonb NOT NULL DEFAULT '{}'::jsonb,
  assignment_rules jsonb NOT NULL DEFAULT '{}'::jsonb,
  follow_up_rules jsonb NOT NULL DEFAULT '{}'::jsonb,
  keywords jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_tenant_products_account_key UNIQUE(account_id, product_service_id)
);

CREATE INDEX IF NOT EXISTS idx_tenant_products_account
  ON public.tenant_products(account_id, enabled);

CREATE INDEX IF NOT EXISTS idx_tenant_products_key
  ON public.tenant_products(account_id, product_service_id);

-- RLS
ALTER TABLE public.tenant_products ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_products_select ON public.tenant_products;
CREATE POLICY tenant_products_select ON public.tenant_products
  FOR SELECT USING (is_account_member(account_id));

DROP POLICY IF EXISTS tenant_products_insert ON public.tenant_products;
CREATE POLICY tenant_products_insert ON public.tenant_products
  FOR INSERT WITH CHECK (is_account_member(account_id, 'admin'));

DROP POLICY IF EXISTS tenant_products_update ON public.tenant_products;
CREATE POLICY tenant_products_update ON public.tenant_products
  FOR UPDATE USING (is_account_member(account_id, 'admin'))
  WITH CHECK (is_account_member(account_id, 'admin'));

DROP POLICY IF EXISTS tenant_products_delete ON public.tenant_products;
CREATE POLICY tenant_products_delete ON public.tenant_products
  FOR DELETE USING (is_account_member(account_id, 'admin'));

-- Clean up any legacy 'FOR ALL' policy if previously created
DROP POLICY IF EXISTS tenant_products_all ON public.tenant_products;

GRANT ALL ON TABLE public.tenant_products TO service_role, authenticated;

-- 6. Migrate Geniplus seed records ONLY for the verified Geniplus tenant
DO $$
DECLARE
  v_geniplus_account_id UUID;
BEGIN
  -- Resolve Geniplus account via verified WhatsApp phone_number_id (Meta Graph verified: "Geniplus Academy")
  SELECT account_id INTO v_geniplus_account_id
  FROM public.whatsapp_config
  WHERE phone_number_id = '1371412096054120'
  LIMIT 1;

  -- Fallback to verified ground-truth account ID if whatsapp_config is unlinked
  IF v_geniplus_account_id IS NULL THEN
    SELECT id INTO v_geniplus_account_id
    FROM public.accounts
    WHERE id = '5d5413c2-6097-4ffe-bad8-2a992dca93a8';
  END IF;

  IF v_geniplus_account_id IS NOT NULL THEN
    INSERT INTO public.tenant_products (
      account_id, product_service_id, name, description, category, enabled,
      appointment_type, duration_minutes, required_fields, optional_fields,
      meeting_mode, event_title_template, tags, keywords
    ) VALUES
    (
      v_geniplus_account_id, 'ABACUS_KIDS', 'Abacus Mental Math Program',
      'Mental math classes and brain development for children aged 5-14', 'Kids Program', true,
      'Free Abacus Demo', 45, '["name", "date", "time"]'::jsonb, '["email", "childAge"]'::jsonb,
      'GOOGLE_MEET', '{{name}} - Abacus Demo',
      '{"interestTag": "ABACUS_KIDS_INTEREST", "requestedTag": "DEMO_REQUESTED", "bookedTag": "DEMO_BOOKED"}'::jsonb,
      '["abacus", "mental math", "abacus kids", "abacus class", "demo for my son", "demo for my kid", "trial class for my son"]'::jsonb
    ),
    (
      v_geniplus_account_id, 'GTC', 'Abacus Teacher Training / GTC',
      'Teacher training course to start your own certified Abacus academy', 'Teacher Training', true,
      'GTC Training / Business Call', 30, '["name", "date", "time"]'::jsonb, '["email"]'::jsonb,
      'NONE', '{{name}} - GTC Training Call',
      '{"interestTag": "GTC_INTEREST", "requestedTag": "CALL_REQUESTED", "bookedTag": "CALL_BOOKED"}'::jsonb,
      '["abacus teach", "teacher training", "start my own abacus", "gtc", "become an abacus teacher", "abacus trainer"]'::jsonb
    ),
    (
      v_geniplus_account_id, 'RUBIKS_CUBE', 'Rubik''s Cube Program',
      'Speedcubing and cube solving classes for kids', 'Kids Program', true,
      'Rubik''s Cube Demo', 45, '["name", "date", "time"]'::jsonb, '["email"]'::jsonb,
      'GOOGLE_MEET', '{{name}} - Rubik''s Cube Demo',
      '{"interestTag": "RUBIKS_CUBE_INTEREST", "requestedTag": "DEMO_REQUESTED", "bookedTag": "DEMO_BOOKED"}'::jsonb,
      '["rubik", "rubik''s cube", "speedcubing", "cube class", "solve cube"]'::jsonb
    ),
    (
      v_geniplus_account_id, 'GOLD', 'Gold Program',
      'Academy growth, high-ticket sales, and student acquisition for coaching owners', 'Business Coaching', true,
      'Gold Business Growth Call', 45, '["name", "date", "time"]'::jsonb, '["email"]'::jsonb,
      'NONE', '{{name}} - Business Growth Call',
      '{"interestTag": "GOLD_INTEREST", "requestedTag": "CALL_REQUESTED", "bookedTag": "CALL_BOOKED"}'::jsonb,
      '["grow my coaching", "coaching business", "gold program", "gold interest", "more leads and better sales"]'::jsonb
    ),
    (
      v_geniplus_account_id, 'MAA', 'MAA — My Abacus Academy',
      'Academy software for student management, attendance, fee collection, and exams', 'Software', true,
      'MAA Product Demo', 30, '["name", "date", "time"]'::jsonb, '["email"]'::jsonb,
      'GOOGLE_MEET', '{{name}} - MAA Product Demo',
      '{"interestTag": "MAA_INTEREST", "requestedTag": "DEMO_REQUESTED", "bookedTag": "DEMO_BOOKED"}'::jsonb,
      '["manage my abacus academy", "software to manage", "academy software", "student and fee management", "maa"]'::jsonb
    ),
    (
      v_geniplus_account_id, 'LEAD_PILOT', 'Lead Pilot',
      'WhatsApp CRM and AI lead conversion automation for coaches and academy owners', 'Software', true,
      'Lead Pilot Demo / Call', 30, '["name", "date", "time"]'::jsonb, '["email"]'::jsonb,
      'GOOGLE_MEET', '{{name}} - Lead Pilot Demo',
      '{"interestTag": "LEAD_PILOT_INTEREST", "requestedTag": "DEMO_REQUESTED", "bookedTag": "DEMO_BOOKED"}'::jsonb,
      '["lead pilot", "leadpilot", "whatsapp crm", "whatsapp automation", "leads automation"]'::jsonb
    )
    ON CONFLICT (account_id, product_service_id) DO NOTHING;
  END IF;
END $$;
