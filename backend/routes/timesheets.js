// backend/routes/timesheets.js — Daily & Monthly Timesheet Entry with Project-Wise Hours
const express = require("express");
const db = require("../db");
const { authRequired } = require("../middleware/auth");
const router = express.Router();

const STANDARD_DAY_HOURS = 9;

function canEditMember(req, memberId) {
  return req.user.role === "admin" || String(req.user.member_id) === String(memberId);
}

// GET /api/timesheets — fetch month entries and days
router.get("/", authRequired, async (req, res) => {
  const { month, member_id } = req.query || {};
  let sql = "SELECT te.*, p.abbr, p.project_no, p.name as project_name FROM timesheet_entries te JOIN projects p ON p.id = te.project_id WHERE 1=1";
  const params = [];

  if (month) {
    params.push(`${month}%`);
    sql += ` AND te.date LIKE $${params.length}`;
  }
  if (member_id) {
    params.push(member_id);
    sql += ` AND te.member_id = $${params.length}`;
  }

  try {
    const entries = (await db.query(sql, params)).rows;

    let daySql = "SELECT * FROM timesheet_days WHERE 1=1";
    const dayParams = [];
    if (month) {
      dayParams.push(`${month}%`);
      daySql += ` AND date LIKE $${dayParams.length}`;
    }
    if (member_id) {
      dayParams.push(member_id);
      daySql += ` AND member_id = $${dayParams.length}`;
    }

    const days = (await db.query(daySql, dayParams)).rows;
    res.json({ entries, days });
  } catch (err) {
    console.error("Fetch timesheets error:", err);
    res.status(500).json({ error: "Failed to fetch timesheet records" });
  }
});

// GET /api/timesheets/monthly — full project-wise monthly timesheet dataset
router.get("/monthly", authRequired, async (req, res) => {
  try {
    const month = req.query.month || new Date().toISOString().slice(0, 7);
    let memberId = req.user.role === "admin" ? (req.query.member_id || req.user.member_id) : req.user.member_id;

    if (!memberId && req.user.role === "admin") {
      const firstMember = await db.query("SELECT id FROM members WHERE active = 1 ORDER BY order_index, id LIMIT 1");
      memberId = firstMember.rows[0]?.id || null;
    }

    if (!memberId) {
      return res.status(400).json({ error: "No member identified for timesheet" });
    }

    // Get member info
    const memRes = await db.query("SELECT id, name, order_index, active, rate FROM members WHERE id = $1", [memberId]);
    const member = memRes.rows[0] || null;

    // Get projects assigned to this member (active)
    const assignedProjectsRes = await db.query(
      `SELECT DISTINCT p.id, p.project_no, p.name, p.abbr, p.active
       FROM projects p
       JOIN project_members pm ON pm.project_id = p.id
       WHERE pm.member_id = $1 AND p.active = 1
       ORDER BY p.project_no, p.id`,
      [memberId]
    );

    // Also get projects where member has logged hours in this month (so historical logged hours are visible)
    const loggedProjectsRes = await db.query(
      `SELECT DISTINCT p.id, p.project_no, p.name, p.abbr, p.active
       FROM projects p
       JOIN timesheet_entries te ON te.project_id = p.id
       WHERE te.member_id = $1 AND te.date LIKE $2`,
      [memberId, `${month}%`]
    );

    // Merge projects uniquely
    const projectMap = new Map();
    assignedProjectsRes.rows.forEach((p) => projectMap.set(p.id, p));
    loggedProjectsRes.rows.forEach((p) => projectMap.set(p.id, p));
    const projects = Array.from(projectMap.values()).sort((a, b) => {
      const noA = (a.project_no || "").toLowerCase();
      const noB = (b.project_no || "").toLowerCase();
      if (noA < noB) return -1;
      if (noA > noB) return 1;
      return a.id - b.id;
    });

    // Get timesheet entries for this member in this month
    const entriesRes = await db.query(
      `SELECT te.id, te.member_id, te.project_id, te.date, te.hours, te.narration, te.task_id,
              p.project_no, p.abbr, p.name as project_name
       FROM timesheet_entries te
       JOIN projects p ON p.id = te.project_id
       WHERE te.member_id = $1 AND te.date LIKE $2
       ORDER BY te.date ASC, te.id ASC`,
      [memberId, `${month}%`]
    );

    // Get leaves for this member
    const leavesRes = await db.query(
      "SELECT * FROM leaves WHERE member_id = $1 AND date LIKE $2 ORDER BY date ASC",
      [memberId, `${month}%`]
    );

    // Get public holidays
    const holidaysRes = await db.query(
      "SELECT * FROM holidays WHERE date LIKE $1 ORDER BY date ASC",
      [`${month}%`]
    );

    // Get timesheet extra remarks
    const daysRes = await db.query(
      "SELECT * FROM timesheet_days WHERE member_id = $1 AND date LIKE $2",
      [memberId, `${month}%`]
    );

    res.json({
      member,
      month,
      projects,
      entries: entriesRes.rows,
      leaves: leavesRes.rows,
      holidays: holidaysRes.rows,
      days: daysRes.rows,
    });
  } catch (err) {
    console.error("Fetch monthly timesheet error:", err);
    res.status(500).json({ error: "Failed to fetch monthly timesheet" });
  }
});

// POST /api/timesheets/save-cell — fast single cell autosave
router.post("/save-cell", authRequired, async (req, res) => {
  let { member_id, project_id, date, hours, narration } = req.body || {};

  // Employees can only edit their own hours
  if (req.user.role !== "admin") {
    member_id = req.user.member_id;
  } else if (!member_id) {
    member_id = req.user.member_id;
  }

  if (!member_id || !project_id || !date) {
    return res.status(400).json({ error: "member_id, project_id, and date are required" });
  }

  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return res.status(400).json({ error: "Invalid date format. Expected YYYY-MM-DD" });
  }

  const numHours = parseFloat(hours);
  if (isNaN(numHours) || numHours < 0 || numHours > 24) {
    return res.status(400).json({ error: "Hours must be a number between 0 and 24" });
  }

  const roundedHours = Math.round(numHours * 100) / 100;
  const monthPrefix = date.slice(0, 7) + "%";

  try {
    if (roundedHours === 0) {
      // Remove entry if 0 hours
      await db.query(
        "DELETE FROM timesheet_entries WHERE member_id = $1 AND project_id = $2 AND date = $3",
        [member_id, project_id, date]
      );
    } else {
      // Upsert entry
      await db.query(
        `INSERT INTO timesheet_entries (member_id, project_id, date, hours, narration, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, NOW(), NOW())
         ON CONFLICT (member_id, project_id, date)
         DO UPDATE SET hours = EXCLUDED.hours, narration = EXCLUDED.narration, updated_at = NOW()`,
        [member_id, project_id, date, roundedHours, (narration || "").trim()]
      );
    }

    // Calculate updated daily total
    const daySumRes = await db.query(
      "SELECT COALESCE(SUM(hours), 0) as daily_total FROM timesheet_entries WHERE member_id = $1 AND date = $2",
      [member_id, date]
    );
    const dailyTotal = parseFloat(daySumRes.rows[0]?.daily_total || "0");

    // Calculate updated project total for month
    const projSumRes = await db.query(
      "SELECT COALESCE(SUM(hours), 0) as project_total FROM timesheet_entries WHERE member_id = $1 AND project_id = $2 AND date LIKE $3",
      [member_id, project_id, monthPrefix]
    );
    const projectTotal = parseFloat(projSumRes.rows[0]?.project_total || "0");

    // Calculate updated monthly total for all projects
    const monthSumRes = await db.query(
      "SELECT COALESCE(SUM(hours), 0) as month_total FROM timesheet_entries WHERE member_id = $1 AND date LIKE $2",
      [member_id, monthPrefix]
    );
    const monthTotal = parseFloat(monthSumRes.rows[0]?.month_total || "0");

    res.json({
      ok: true,
      member_id,
      project_id,
      date,
      hours: roundedHours,
      daily_total: dailyTotal,
      project_total: projectTotal,
      month_total: monthTotal,
    });
  } catch (err) {
    console.error("Save timesheet cell error:", err);
    res.status(500).json({ error: "Failed to save timesheet entry" });
  }
});

// GET /api/timesheets/day — fetch single member day details
router.get("/day", authRequired, async (req, res) => {
  const { member_id, date } = req.query || {};
  if (!member_id || !date) {
    return res.status(400).json({ error: "member_id and date are required" });
  }

  try {
    const entries = (
      await db.query(
        `SELECT te.*, p.abbr, p.project_no, p.name as project_name
         FROM timesheet_entries te
         JOIN projects p ON p.id = te.project_id
         WHERE te.member_id = $1 AND te.date = $2`,
        [member_id, date]
      )
    ).rows;

    const dayMeta = (
      await db.query(
        "SELECT * FROM timesheet_days WHERE member_id = $1 AND date = $2",
        [member_id, date]
      )
    ).rows[0];

    res.json({ entries, extra_remark: dayMeta?.extra_remark || "" });
  } catch (err) {
    console.error("Fetch timesheet day error:", err);
    res.status(500).json({ error: "Failed to fetch day timesheet" });
  }
});

// PUT /api/timesheets/day — save day hours with 9-hour validation & task actual hours sync
router.put("/day", authRequired, async (req, res) => {
  const { member_id, date, rows, extra_remark } = req.body || {};
  if (!member_id || !date || !Array.isArray(rows)) {
    return res.status(400).json({ error: "member_id, date, and rows are required" });
  }
  if (!canEditMember(req, member_id)) {
    return res.status(403).json({ error: "Can only log your own timesheets" });
  }

  const total = rows.reduce((a, r) => a + (parseFloat(r.hours) || 0), 0);
  if (total > STANDARD_DAY_HOURS && !(extra_remark || "").trim()) {
    return res.status(400).json({
      error: `Additional-hours remark is required when daily total exceeds ${STANDARD_DAY_HOURS} hours`,
      total,
    });
  }

  try {
    // Find prior task_ids linked on this day to resync their hours if removed
    const priorEntries = (
      await db.query(
        "SELECT DISTINCT task_id FROM timesheet_entries WHERE member_id = $1 AND date = $2 AND task_id IS NOT NULL",
        [member_id, date]
      )
    ).rows.map((r) => r.task_id);

    // Delete old entries for this day
    await db.query("DELETE FROM timesheet_entries WHERE member_id = $1 AND date = $2", [
      member_id,
      date,
    ]);

    const validRows = rows.filter((r) => r.project_id && parseFloat(r.hours) > 0);
    for (const r of validRows) {
      await db.query(
        `INSERT INTO timesheet_entries (member_id, date, project_id, hours, task_id, narration, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, NOW(), NOW())
         ON CONFLICT (member_id, project_id, date)
         DO UPDATE SET hours = EXCLUDED.hours, task_id = EXCLUDED.task_id, narration = EXCLUDED.narration, updated_at = NOW()`,
        [
          member_id,
          date,
          r.project_id,
          parseFloat(r.hours),
          r.task_id || null,
          (r.narration || "").trim(),
        ]
      );
    }

    // Overtime metadata
    await db.query("DELETE FROM timesheet_days WHERE member_id = $1 AND date = $2", [
      member_id,
      date,
    ]);

    if (total > STANDARD_DAY_HOURS) {
      await db.query(
        "INSERT INTO timesheet_days (member_id, date, extra_remark) VALUES ($1, $2, $3)",
        [member_id, date, extra_remark.trim()]
      );
    }

    // Synchronize actual_hours on all affected tasks
    const newTasks = validRows.filter((r) => r.task_id).map((r) => r.task_id);
    const affectedTaskIds = [...new Set([...priorEntries, ...newTasks])];

    for (const tid of affectedTaskIds) {
      if (!tid) continue;
      const sumRes = await db.query(
        "SELECT COALESCE(SUM(hours), 0) h FROM timesheet_entries WHERE task_id = $1",
        [tid]
      );
      await db.query("UPDATE tasks SET actual_hours = $1 WHERE id = $2", [
        parseFloat(sumRes.rows[0].h || "0"),
        tid,
      ]);
    }

    res.json({
      ok: true,
      total,
      status:
        total === STANDARD_DAY_HOURS ? "complete" : total < STANDARD_DAY_HOURS ? "under" : "over",
    });
  } catch (err) {
    console.error("Save timesheet day error:", err);
    res.status(500).json({ error: "Failed to save timesheet" });
  }
});

module.exports = router;
