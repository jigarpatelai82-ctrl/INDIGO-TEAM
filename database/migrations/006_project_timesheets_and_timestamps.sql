-- Migration 006: Add timestamps and unique constraint on timesheet_entries
ALTER TABLE timesheet_entries ADD COLUMN IF NOT EXISTS created_at TIMESTAMP NOT NULL DEFAULT NOW();
ALTER TABLE timesheet_entries ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP NOT NULL DEFAULT NOW();

-- Deduplicate any past duplicate entries if they exist before creating unique index
DELETE FROM timesheet_entries a USING timesheet_entries b
WHERE a.id < b.id 
  AND a.member_id = b.member_id 
  AND a.project_id = b.project_id 
  AND a.date = b.date;

-- Create unique index on (member_id, project_id, date) for fast upserts
CREATE UNIQUE INDEX IF NOT EXISTS uq_timesheet_member_project_date ON timesheet_entries (member_id, project_id, date);
