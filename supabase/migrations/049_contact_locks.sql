-- ============================================================
-- 049_contact_locks.sql
--
-- Distributed concurrency lock for serverless WhatsApp webhooks.
-- Prevents race conditions, out-of-order replies, and duplicate
-- actions across multi-instance serverless deployments.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.contact_locks (
  contact_id TEXT PRIMARY KEY,
  owner_token TEXT NOT NULL,
  locked_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL
);

-- Index on expires_at for quick lease expiration cleanup
CREATE INDEX IF NOT EXISTS idx_contact_locks_expires ON public.contact_locks (expires_at);

-- Function to atomically acquire a lease lock
CREATE OR REPLACE FUNCTION public.acquire_contact_lock(
  p_contact_id TEXT,
  p_owner_token TEXT,
  p_ttl_seconds INT DEFAULT 30
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_acquired BOOLEAN := FALSE;
BEGIN
  -- Clean up expired locks for this contact first or attempt CAS upsert
  INSERT INTO public.contact_locks (contact_id, owner_token, locked_at, expires_at)
  VALUES (
    p_contact_id,
    p_owner_token,
    NOW(),
    NOW() + (p_ttl_seconds || ' seconds')::INTERVAL
  )
  ON CONFLICT (contact_id) DO UPDATE
  SET owner_token = EXCLUDED.owner_token,
      locked_at   = NOW(),
      expires_at  = EXCLUDED.expires_at
  WHERE contact_locks.expires_at < NOW();

  IF FOUND THEN
    v_acquired := TRUE;
  END IF;

  RETURN v_acquired;
END;
$$;

-- Function to renew/heartbeat the lease lock
CREATE OR REPLACE FUNCTION public.renew_contact_lock(
  p_contact_id TEXT,
  p_owner_token TEXT,
  p_ttl_seconds INT DEFAULT 30
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_renewed BOOLEAN := FALSE;
BEGIN
  UPDATE public.contact_locks
  SET expires_at = NOW() + (p_ttl_seconds || ' seconds')::INTERVAL
  WHERE contact_id = p_contact_id
    AND owner_token = p_owner_token;

  IF FOUND THEN
    v_renewed := TRUE;
  END IF;

  RETURN v_renewed;
END;
$$;

-- Function to release the lease lock
CREATE OR REPLACE FUNCTION public.release_contact_lock(
  p_contact_id TEXT,
  p_owner_token TEXT
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  DELETE FROM public.contact_locks
  WHERE contact_id = p_contact_id
    AND owner_token = p_owner_token;
END;
$$;
