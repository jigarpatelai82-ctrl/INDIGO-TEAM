-- Migration 002: Add Task Acceptance and Acknowledgment Columns
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS viewed_at TIMESTAMP;
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS accepted_at TIMESTAMP;
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS admin_seen_acceptance INTEGER NOT NULL DEFAULT 1;
