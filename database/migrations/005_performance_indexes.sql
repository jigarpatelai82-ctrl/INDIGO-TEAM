-- Migration 005: Create performance indexes for high-frequency queries
CREATE INDEX IF NOT EXISTS idx_tasks_assigned_to ON tasks(assigned_to);
CREATE INDEX IF NOT EXISTS idx_tasks_due_date ON tasks(due_date);
CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
CREATE INDEX IF NOT EXISTS idx_timesheet_entries_date ON timesheet_entries(date);
CREATE INDEX IF NOT EXISTS idx_timesheet_entries_member_date ON timesheet_entries(member_id, date);
CREATE INDEX IF NOT EXISTS idx_timesheet_entries_project ON timesheet_entries(project_id);
CREATE INDEX IF NOT EXISTS idx_timesheet_entries_task ON timesheet_entries(task_id);
CREATE INDEX IF NOT EXISTS idx_leaves_date ON leaves(date);
CREATE INDEX IF NOT EXISTS idx_leaves_member_date ON leaves(member_id, date);
CREATE INDEX IF NOT EXISTS idx_users_username ON users(username);
