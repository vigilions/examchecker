-- Run in Supabase Dashboard → SQL Editor, after supabase-access-migration.sql
-- Adds a teacher/student role to each access request.

ALTER TABLE user_access
  ADD COLUMN IF NOT EXISTS role TEXT NOT NULL DEFAULT 'teacher' CHECK (role IN ('teacher', 'student'));

-- Existing rows predate this column and were all teachers (the app was
-- teacher-only until now) — the DEFAULT above already backfills them,
-- this UPDATE is only here for clarity/idempotency if the default ever changes.
UPDATE user_access SET role = 'teacher' WHERE role IS NULL;
