-- ============================================================
-- 046_ai_agent_actions.sql
--
-- AI Agent Action System: Lead scoring, lead temperature,
-- auditable action event logs, configurable product appointment
-- routing, and non-blocking contact notes for automated assistants.
-- ============================================================

-- 1. Contacts Extension: Structured Lead Temperature & Scoring
ALTER TABLE public.contacts
  ADD COLUMN IF NOT EXISTS lead_score integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS lead_temperature text CHECK (lead_temperature IN ('cold', 'warm', 'hot')),
  ADD COLUMN IF NOT EXISTS lead_score_events jsonb NOT NULL DEFAULT '[]'::jsonb;

CREATE INDEX IF NOT EXISTS idx_contacts_account_lead_temp
  ON public.contacts(account_id, lead_temperature);

CREATE INDEX IF NOT EXISTS idx_contacts_account_lead_score
  ON public.contacts(account_id, lead_score DESC);

-- 2. Allow system / AI agent notes on contacts
ALTER TABLE public.contact_notes
  ALTER COLUMN user_id DROP NOT NULL;

ALTER TABLE public.contact_notes
  ADD COLUMN IF NOT EXISTS author_type text NOT NULL DEFAULT 'user'
  CHECK (author_type IN ('user', 'ai_agent', 'system'));

-- 3. AI Action Event Logs (Audit trail for AI-triggered actions)
CREATE TABLE IF NOT EXISTS public.ai_action_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  contact_id uuid REFERENCES public.contacts(id) ON DELETE CASCADE,
  conversation_id uuid REFERENCES public.conversations(id) ON DELETE SET NULL,
  action text NOT NULL,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  source text NOT NULL DEFAULT 'ai_agent',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ai_action_logs_account_created
  ON public.ai_action_logs(account_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_ai_action_logs_contact
  ON public.ai_action_logs(contact_id);

CREATE INDEX IF NOT EXISTS idx_ai_action_logs_conversation
  ON public.ai_action_logs(conversation_id);

ALTER TABLE public.ai_action_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS ai_action_logs_select ON public.ai_action_logs;
CREATE POLICY ai_action_logs_select ON public.ai_action_logs
  FOR SELECT USING (is_account_member(account_id, 'viewer'));

DROP POLICY IF EXISTS ai_action_logs_insert ON public.ai_action_logs;
CREATE POLICY ai_action_logs_insert ON public.ai_action_logs
  FOR INSERT WITH CHECK (is_account_member(account_id, 'agent'));

GRANT ALL ON TABLE public.ai_action_logs TO service_role, authenticated;

-- 4. Extend ai_configs for configurable product mappings & routing
ALTER TABLE public.ai_configs
  ADD COLUMN IF NOT EXISTS action_system_enabled boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS product_configs jsonb,
  ADD COLUMN IF NOT EXISTS scoring_rules jsonb,
  ADD COLUMN IF NOT EXISTS routing_rules jsonb;
