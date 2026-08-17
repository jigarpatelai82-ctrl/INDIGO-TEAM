// backend/routes/timesheets.js — Daily Timesheet Entry & 9-Hour Rule Validation
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
  let sql = "SELECT * FROM timesheet_entries WHERE 1=1";
  const params = [];

  if (month) {
    params.push(`${month}%`);
    sql += ` AND date LIKE $${params.length}`;
  }
  if (member_id) {
    params.push(member_id);
    sql += ` AND member_id = $${params.length}`;
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
        `INSERT INTO timesheet_entries (member_id, date, project_id, hours, task_id, narration)
         VALUES ($1, $2, $3, $4, $5, $6)`,
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
