-- Migration 001: Initial Schema for INDIGO TEAM
-- Creates all base tables with constraints, default values, and foreign keys.

CREATE TABLE IF NOT EXISTS members (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  order_index INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1,
  rate REAL NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  username TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK(role IN ('admin','employee')),
  member_id INTEGER REFERENCES members(id) ON DELETE SET NULL,
  email TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  must_change_password INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS clients (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  contact_person TEXT DEFAULT '',
  email TEXT DEFAULT '',
  phone TEXT DEFAULT '',
  address TEXT DEFAULT '',
  remarks TEXT DEFAULT '',
  active INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS projects (
  id SERIAL PRIMARY KEY,
  project_no TEXT NOT NULL,
  abbr TEXT NOT NULL,
  name TEXT NOT NULL,
  fee REAL NOT NULL DEFAULT 0,
  manual_hours REAL NOT NULL DEFAULT 0,
  remarks TEXT DEFAULT '',
  active INTEGER NOT NULL DEFAULT 1,
  client_id INTEGER REFERENCES clients(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS project_members (
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  member_id INTEGER NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  PRIMARY KEY (project_id, member_id)
);

CREATE TABLE IF NOT EXISTS leaves (
  id SERIAL PRIMARY KEY,
  member_id INTEGER NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  date TEXT NOT NULL,
  status TEXT NOT NULL,
  remarks TEXT DEFAULT '',
  UNIQUE(member_id, date)
);

CREATE TABLE IF NOT EXISTS holidays (
  date TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  remarks TEXT DEFAULT ''
);

CREATE TABLE IF NOT EXISTS tasks (
  id SERIAL PRIMARY KEY,
  title TEXT NOT NULL,
  description TEXT DEFAULT '',
  assigned_to INTEGER NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  assigned_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  project_id INTEGER REFERENCES projects(id) ON DELETE SET NULL,
  priority INTEGER NOT NULL DEFAULT 2 CHECK(priority IN (1,2,3)),
  importance TEXT NOT NULL DEFAULT 'Medium' CHECK(importance IN ('High','Medium','Low')),
  estimated_hours REAL NOT NULL DEFAULT 0,
  actual_hours REAL NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'Pending' CHECK(status IN ('Pending','In Progress','Completed','On Hold')),
  due_date TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMP,
  viewed_at TIMESTAMP,
  accepted_at TIMESTAMP,
  admin_seen_acceptance INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS timesheet_entries (
  id SERIAL PRIMARY KEY,
  member_id INTEGER NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  date TEXT NOT NULL,
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  hours REAL NOT NULL,
  task_id INTEGER REFERENCES tasks(id) ON DELETE SET NULL,
  narration TEXT DEFAULT ''
);

CREATE TABLE IF NOT EXISTS timesheet_days (
  member_id INTEGER NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  date TEXT NOT NULL,
  extra_remark TEXT DEFAULT '',
  PRIMARY KEY (member_id, date)
);

CREATE TABLE IF NOT EXISTS audit_log (
  id SERIAL PRIMARY KEY,
  user_id INTEGER,
  action TEXT NOT NULL,
  detail TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- Performance Indexes
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
