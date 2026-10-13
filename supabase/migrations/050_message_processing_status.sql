-- ============================================================
-- 050_message_processing_status.sql
--
-- Tracks inbound message lifecycle state:
-- 'received'   -> Inbound webhook inserted row into DB
-- 'processing' -> Pipeline (AI / automations / flows) is actively running
-- 'replied'    -> Response was sent / processing completed successfully
-- 'failed'     -> Pipeline crashed or threw unexpected error
--
-- Ensures duplicate webhook replays short-circuit if already replied,
-- but crashed/unhandled messages can safely resume processing rather than
-- being permanently swallowed.
-- ============================================================

ALTER TABLE public.messages
  ADD COLUMN IF NOT EXISTS processing_status TEXT DEFAULT 'received';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'chk_messages_processing_status'
  ) THEN
    ALTER TABLE public.messages
      ADD CONSTRAINT chk_messages_processing_status
      CHECK (processing_status IN ('received', 'processing', 'replied', 'failed'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_messages_processing_status
  ON public.messages (processing_status)
  WHERE processing_status IN ('received', 'processing');
