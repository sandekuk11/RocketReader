-- Run this in the Supabase SQL Editor after schema.sql

-- Reader profiles (multiple per browser/user)
CREATE TABLE IF NOT EXISTS profiles (
  id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name       TEXT        NOT NULL,
  age        INTEGER     NOT NULL CHECK (age BETWEEN 4 AND 18),
  color      TEXT        NOT NULL DEFAULT '#1565C0',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Link history entries to a specific profile
ALTER TABLE reading_history
  ADD COLUMN IF NOT EXISTS profile_id UUID REFERENCES profiles(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_profiles_user_id   ON profiles(user_id);
CREATE INDEX IF NOT EXISTS idx_history_profile_id ON reading_history(profile_id);
