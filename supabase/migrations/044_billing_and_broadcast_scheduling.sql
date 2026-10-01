-- ============================================================
-- 044_billing_and_broadcast_scheduling.sql
--
-- Adds messaging fund wallet, billing transactions, and broadcast
-- event scheduling support for WhatsApp campaigns.
-- ============================================================

-- 1. Account Wallets (stores messaging balance and rates)
CREATE TABLE IF NOT EXISTS public.account_wallets (
  account_id UUID PRIMARY KEY REFERENCES public.accounts(id) ON DELETE CASCADE,
  balance NUMERIC(12, 2) NOT NULL DEFAULT 0.00,
  currency TEXT NOT NULL DEFAULT 'INR',
  marketing_rate NUMERIC(6, 4) NOT NULL DEFAULT 0.88,
  utility_rate NUMERIC(6, 4) NOT NULL DEFAULT 0.15,
  auth_rate NUMERIC(6, 4) NOT NULL DEFAULT 0.15,
  service_rate NUMERIC(6, 4) NOT NULL DEFAULT 0.30,
  low_balance_threshold NUMERIC(12, 2) NOT NULL DEFAULT 100.00,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 2. Billing Transactions & Fund Additions
CREATE TABLE IF NOT EXISTS public.account_billing_funds (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  type TEXT NOT NULL DEFAULT 'credit', -- 'credit' (add funds) | 'debit' (broadcast expense)
  amount NUMERIC(12, 2) NOT NULL,
  balance_after NUMERIC(12, 2) NOT NULL DEFAULT 0.00,
  description TEXT NOT NULL,
  reference TEXT,
  broadcast_id UUID REFERENCES public.broadcasts(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_billing_funds_account_created
  ON public.account_billing_funds(account_id, created_at DESC);

-- 3. Row Level Security
ALTER TABLE public.account_wallets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.account_billing_funds ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS account_wallets_select ON public.account_wallets;
CREATE POLICY account_wallets_select ON public.account_wallets
  FOR SELECT USING (is_account_member(account_id, 'viewer'));

DROP POLICY IF EXISTS account_wallets_all ON public.account_wallets;
CREATE POLICY account_wallets_all ON public.account_wallets
  FOR ALL USING (is_account_member(account_id, 'admin'));

DROP POLICY IF EXISTS account_billing_funds_select ON public.account_billing_funds;
CREATE POLICY account_billing_funds_select ON public.account_billing_funds
  FOR SELECT USING (is_account_member(account_id, 'viewer'));

DROP POLICY IF EXISTS account_billing_funds_insert ON public.account_billing_funds;
CREATE POLICY account_billing_funds_insert ON public.account_billing_funds
  FOR INSERT WITH CHECK (is_account_member(account_id, 'admin'));

GRANT ALL ON TABLE public.account_wallets TO service_role, authenticated;
GRANT ALL ON TABLE public.account_billing_funds TO service_role, authenticated;
