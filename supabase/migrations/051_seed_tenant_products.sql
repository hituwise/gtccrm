-- ============================================================
-- 051_seed_tenant_products.sql
--
-- Seeds default product catalog for Geniplus directly into the
-- public.tenant_products database table.
--
-- This ensures Geniplus keeps its complete product catalog in the database
-- before relying on env gating or deprecating hardcoded seed fallbacks.
-- ============================================================

DO $$
DECLARE
  v_account_id UUID;
BEGIN
  -- Resolve Geniplus account_id via whatsapp_config or accounts
  SELECT account_id INTO v_account_id
  FROM public.whatsapp_config
  WHERE phone_number_id IN ('137141206140027', '5d5413c2-0efd-4e94-82a8-8ad7b82fe755')
  LIMIT 1;

  IF v_account_id IS NULL THEN
    SELECT id INTO v_account_id
    FROM public.accounts
    WHERE name ILIKE '%geniplus%'
    LIMIT 1;
  END IF;

  -- If still null, pick the earliest active account or fallback
  IF v_account_id IS NULL THEN
    SELECT id INTO v_account_id
    FROM public.accounts
    ORDER BY created_at ASC
    LIMIT 1;
  END IF;

  IF v_account_id IS NOT NULL THEN
    -- 1. ABACUS_KIDS
    INSERT INTO public.tenant_products (
      account_id, product_service_id, name, description, category, enabled,
      appointment_type, duration_minutes, required_fields, optional_fields,
      meeting_mode, event_title_template, tags, keywords
    ) VALUES (
      v_account_id, 'ABACUS_KIDS', 'Abacus Mental Math for Kids',
      'Mental math and brain development classes for children aged 5-14', 'Education', true,
      'Abacus Demo Class', 45, '["name", "date", "time", "child_age"]'::jsonb, '["email", "child_name"]'::jsonb,
      'GOOGLE_MEET', '{{name}} - Abacus Demo Class',
      '{"interestTag": "ABACUS_KIDS_INTEREST", "requestedTag": "DEMO_REQUESTED", "bookedTag": "DEMO_BOOKED", "purchasedTag": "PURCHASED"}'::jsonb,
      '["abacus class", "abacus for kids", "mental math", "demo for my son", "demo for my daughter", "math classes"]'::jsonb
    ) ON CONFLICT (account_id, product_service_id) DO UPDATE
    SET name = EXCLUDED.name, description = EXCLUDED.description, keywords = EXCLUDED.keywords, updated_at = NOW();

    -- 2. GTC (Teacher Training)
    INSERT INTO public.tenant_products (
      account_id, product_service_id, name, description, category, enabled,
      appointment_type, duration_minutes, required_fields, optional_fields,
      meeting_mode, event_title_template, tags, keywords
    ) VALUES (
      v_account_id, 'GTC', 'Teacher Training Course (GTC)',
      'Certified abacus teacher training to start and run your own abacus academy', 'Certification', true,
      'Teacher Training Counseling Call', 30, '["name", "date", "time"]'::jsonb, '["email"]'::jsonb,
      'GOOGLE_MEET', '{{name}} - Teacher Training Counseling Call',
      '{"interestTag": "GTC_INTEREST", "requestedTag": "CALL_REQUESTED", "bookedTag": "CALL_BOOKED", "purchasedTag": "PURCHASED"}'::jsonb,
      '["teacher training", "abacus teacher", "start my own abacus", "become an abacus teacher", "gtc", "shikshak"]'::jsonb
    ) ON CONFLICT (account_id, product_service_id) DO UPDATE
    SET name = EXCLUDED.name, description = EXCLUDED.description, keywords = EXCLUDED.keywords, updated_at = NOW();

    -- 3. RUBIKS_CUBE
    INSERT INTO public.tenant_products (
      account_id, product_service_id, name, description, category, enabled,
      appointment_type, duration_minutes, required_fields, optional_fields,
      meeting_mode, event_title_template, tags, keywords
    ) VALUES (
      v_account_id, 'RUBIKS_CUBE', 'Rubik''s Cube Program',
      'Cube solving and algorithms training program', 'Skill', true,
      'Rubik''s Cube Demo', 30, '["name", "date", "time"]'::jsonb, '["email"]'::jsonb,
      'GOOGLE_MEET', '{{name}} - Rubik''s Cube Demo',
      '{"interestTag": "RUBIKS_CUBE_INTEREST", "requestedTag": "DEMO_REQUESTED", "bookedTag": "DEMO_BOOKED", "purchasedTag": "PURCHASED"}'::jsonb,
      '["rubik", "rubik''s cube", "speedcubing", "solve cube"]'::jsonb
    ) ON CONFLICT (account_id, product_service_id) DO UPDATE
    SET name = EXCLUDED.name, description = EXCLUDED.description, keywords = EXCLUDED.keywords, updated_at = NOW();

    -- 4. GOLD
    INSERT INTO public.tenant_products (
      account_id, product_service_id, name, description, category, enabled,
      appointment_type, duration_minutes, required_fields, optional_fields,
      meeting_mode, event_title_template, tags, keywords
    ) VALUES (
      v_account_id, 'GOLD', 'Business Growth Coaching (Gold)',
      'Marketing, lead generation, and academy scaling mentorship program', 'Mentorship', true,
      'Business Growth Strategy Call', 45, '["name", "date", "time"]'::jsonb, '["email"]'::jsonb,
      'GOOGLE_MEET', '{{name}} - Business Growth Strategy Call',
      '{"interestTag": "GOLD_INTEREST", "requestedTag": "CALL_REQUESTED", "bookedTag": "CALL_BOOKED", "purchasedTag": "PURCHASED"}'::jsonb,
      '["grow my coaching", "coaching business", "more leads", "gold program"]'::jsonb
    ) ON CONFLICT (account_id, product_service_id) DO UPDATE
    SET name = EXCLUDED.name, description = EXCLUDED.description, keywords = EXCLUDED.keywords, updated_at = NOW();

    -- 5. MAA (Academy Software - with negative keywords for franchise)
    INSERT INTO public.tenant_products (
      account_id, product_service_id, name, description, category, enabled,
      appointment_type, duration_minutes, required_fields, optional_fields,
      meeting_mode, event_title_template, tags, keywords, follow_up_rules
    ) VALUES (
      v_account_id, 'MAA', 'Manage My Abacus Academy (MAA)',
      'Software for student, fee, attendance, and academy management', 'Software', true,
      'MAA Product Demo', 30, '["name", "date", "time"]'::jsonb, '["email"]'::jsonb,
      'GOOGLE_MEET', '{{name}} - MAA Product Demo',
      '{"interestTag": "MAA_INTEREST", "requestedTag": "DEMO_REQUESTED", "bookedTag": "DEMO_BOOKED", "purchasedTag": "PURCHASED"}'::jsonb,
      '["manage my abacus academy", "software to manage", "app to manage", "academy software", "student fee software", "maa"]'::jsonb,
      '{"negativeKeywords": ["franchise", "franchisee"]}'::jsonb
    ) ON CONFLICT (account_id, product_service_id) DO UPDATE
    SET name = EXCLUDED.name, description = EXCLUDED.description, keywords = EXCLUDED.keywords, follow_up_rules = EXCLUDED.follow_up_rules, updated_at = NOW();

    -- 6. LEAD_PILOT
    INSERT INTO public.tenant_products (
      account_id, product_service_id, name, description, category, enabled,
      appointment_type, duration_minutes, required_fields, optional_fields,
      meeting_mode, event_title_template, tags, keywords
    ) VALUES (
      v_account_id, 'LEAD_PILOT', 'Lead Pilot',
      'WhatsApp CRM and automated lead conversion system for coaches', 'Software', true,
      'Lead Pilot Demo / Call', 30, '["name", "date", "time"]'::jsonb, '["email"]'::jsonb,
      'GOOGLE_MEET', '{{name}} - Lead Pilot Demo',
      '{"interestTag": "LEAD_PILOT_INTEREST", "requestedTag": "DEMO_REQUESTED", "bookedTag": "DEMO_BOOKED", "purchasedTag": "PURCHASED"}'::jsonb,
      '["whatsapp automation", "lead pilot", "leadpilot", "whatsapp crm", "leads automation"]'::jsonb
    ) ON CONFLICT (account_id, product_service_id) DO UPDATE
    SET name = EXCLUDED.name, description = EXCLUDED.description, keywords = EXCLUDED.keywords, updated_at = NOW();
  END IF;
END $$;
