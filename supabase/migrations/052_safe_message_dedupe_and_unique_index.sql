-- ============================================================
-- Migration 052: Safe Message Deduplication & Non-Partial Unique Index
--
-- Ensures existing production databases that previously applied 037:
-- 1. Repoints all foreign keys referencing messages(id):
--    - messages.reply_to_message_id (ON DELETE SET NULL)
--    - flow_runs.last_prompt_message_id (ON DELETE SET NULL)
--    - message_reactions.message_id (ON DELETE CASCADE)
-- 2. Safely deletes duplicate (conversation_id, message_id) rows, keeping the earliest created row.
-- 3. Ensures a PLAIN (non-partial) UNIQUE INDEX exists on (conversation_id, message_id)
--    so PostgREST ON CONFLICT inference works from column list alone.
--
-- Safe and idempotent to run on all environments.
-- ============================================================

-- 1. Repoint reply_to_message_id references from duplicates to the canonical surviving row (rn = 1)
WITH duplicates AS (
  SELECT id,
         first_value(id) OVER (
           PARTITION BY conversation_id, message_id
           ORDER BY created_at ASC, id ASC
         ) AS keeper_id,
         row_number() OVER (
           PARTITION BY conversation_id, message_id
           ORDER BY created_at ASC, id ASC
         ) AS rn
  FROM public.messages
  WHERE message_id IS NOT NULL
)
UPDATE public.messages m
SET reply_to_message_id = d.keeper_id
FROM duplicates d
WHERE m.reply_to_message_id = d.id
  AND d.rn > 1;

-- 2. Repoint flow_runs.last_prompt_message_id if table exists
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema = 'public' 
      AND table_name = 'flow_runs' 
      AND column_name = 'last_prompt_message_id'
  ) THEN
    WITH duplicates AS (
      SELECT id,
             first_value(id) OVER (
               PARTITION BY conversation_id, message_id
               ORDER BY created_at ASC, id ASC
             ) AS keeper_id,
             row_number() OVER (
               PARTITION BY conversation_id, message_id
               ORDER BY created_at ASC, id ASC
             ) AS rn
      FROM public.messages
      WHERE message_id IS NOT NULL
    )
    UPDATE public.flow_runs fr
    SET last_prompt_message_id = d.keeper_id
    FROM duplicates d
    WHERE fr.last_prompt_message_id = d.id
      AND d.rn > 1;
  END IF;
END $$;

-- 3. Repoint message_reactions if table exists (prune duplicates first to prevent UNIQUE collision)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables 
    WHERE table_schema = 'public' 
      AND table_name = 'message_reactions'
  ) THEN
    WITH duplicates AS (
      SELECT id,
             first_value(id) OVER (
               PARTITION BY conversation_id, message_id
               ORDER BY created_at ASC, id ASC
             ) AS keeper_id,
             row_number() OVER (
               PARTITION BY conversation_id, message_id
               ORDER BY created_at ASC, id ASC
             ) AS rn
      FROM public.messages
      WHERE message_id IS NOT NULL
    )
    DELETE FROM public.message_reactions mr
    USING duplicates d
    WHERE mr.message_id = d.id
      AND d.rn > 1
      AND EXISTS (
        SELECT 1 FROM public.message_reactions existing
        WHERE existing.message_id = d.keeper_id
          AND existing.actor_type = mr.actor_type
          AND (existing.actor_id = mr.actor_id OR (existing.actor_id IS NULL AND mr.actor_id IS NULL))
      );

    WITH duplicates AS (
      SELECT id,
             first_value(id) OVER (
               PARTITION BY conversation_id, message_id
               ORDER BY created_at ASC, id ASC
             ) AS keeper_id,
             row_number() OVER (
               PARTITION BY conversation_id, message_id
               ORDER BY created_at ASC, id ASC
             ) AS rn
      FROM public.messages
      WHERE message_id IS NOT NULL
    )
    UPDATE public.message_reactions mr
    SET message_id = d.keeper_id
    FROM duplicates d
    WHERE mr.message_id = d.id
      AND d.rn > 1;
  END IF;
END $$;

-- 4. Collapse pre-existing duplicate message rows (keep earliest created row)
WITH ranked AS (
  SELECT id,
         row_number() OVER (
           PARTITION BY conversation_id, message_id
           ORDER BY created_at ASC, id ASC
         ) AS rn
  FROM public.messages
  WHERE message_id IS NOT NULL
)
DELETE FROM public.messages m
USING ranked r
WHERE m.id = r.id
  AND r.rn > 1;

-- 5. Guarantee a PLAIN (non-partial) UNIQUE INDEX exists for PostgREST ON CONFLICT inference.
-- If an earlier migration created a partial index with a WHERE clause, drop it so it can be replaced.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_indexes 
    WHERE schemaname = 'public' 
      AND tablename = 'messages' 
      AND indexname = 'idx_messages_conversation_message_id' 
      AND indexdef ILIKE '%WHERE%'
  ) THEN
    DROP INDEX IF EXISTS public.idx_messages_conversation_message_id;
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS idx_messages_conversation_message_id
  ON public.messages (conversation_id, message_id);
