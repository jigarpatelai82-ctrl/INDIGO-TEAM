-- Migration 003: Add Narration column to timesheet entries
ALTER TABLE timesheet_entries ADD COLUMN IF NOT EXISTS narration TEXT DEFAULT '';
