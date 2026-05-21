-- ============================================================================
-- 010_swarm_audit_categories
-- Widen the memories.type CHECK constraint to allow 'audit' so swarm
-- lifecycle events can be persisted as type='audit' memories.
--
-- Category tree seeding (Swarm / Audit, Swarm / Runs, Swarm / Channel) is
-- intentionally NOT done here: memory_categories is a per-user table with
-- RLS, so server-side global INSERTs do not make sense. The Electron
-- swarmAudit helper resolves these categories lazily; if a user does not
-- yet have the tree, the audit memory is still written, just uncategorized.
-- ============================================================================

DO $$
DECLARE
  con_name text;
  con_def  text;
BEGIN
  -- Find the type CHECK constraint on public.memories (name varies by who
  -- created the table — schema.sql autogenerates memories_type_check, but
  -- a manually-tweaked DB might use a different name).
  SELECT c.conname, pg_get_constraintdef(c.oid)
    INTO con_name, con_def
    FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = t.relnamespace
   WHERE n.nspname = 'public'
     AND t.relname = 'memories'
     AND c.contype = 'c'
     AND pg_get_constraintdef(c.oid) ILIKE '%type%'
   LIMIT 1;

  IF con_name IS NULL THEN
    -- No type CHECK at all (already wide open). Add a permissive one that
    -- includes 'audit' for forward compatibility.
    ALTER TABLE public.memories
      ADD CONSTRAINT memories_type_check
      CHECK (type IN ('fact','decision','context','reference','note','idea','task','question','quote','snippet','journal','audit'));
  ELSIF position('audit' in con_def) = 0 THEN
    EXECUTE format('ALTER TABLE public.memories DROP CONSTRAINT %I', con_name);
    ALTER TABLE public.memories
      ADD CONSTRAINT memories_type_check
      CHECK (type IN ('fact','decision','context','reference','note','idea','task','question','quote','snippet','journal','audit'));
  END IF;
END $$;
