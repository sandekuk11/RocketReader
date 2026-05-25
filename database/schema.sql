-- Reading Rocket Database Schema
-- Run this in the Supabase SQL Editor (https://supabase.com/dashboard)

-- Enable UUID generation
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- Users (identified by a UUID stored in the browser)
CREATE TABLE IF NOT EXISTS users (
  id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at TIMESTAMPTZ NOT NULL    DEFAULT NOW()
);

-- Encrypted Claude API keys (one per user, upserted on save)
CREATE TABLE IF NOT EXISTS api_keys (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  encrypted_key TEXT        NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(user_id)
);

-- Reading history entries
CREATE TABLE IF NOT EXISTS reading_history (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  passage_title TEXT        NOT NULL,
  wpm           INTEGER,
  accuracy      INTEGER,
  test_type     TEXT        NOT NULL CHECK (test_type IN ('speed', 'voice')),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_history_user_id ON reading_history(user_id);
CREATE INDEX IF NOT EXISTS idx_api_keys_user_id ON api_keys(user_id);
