// backend/routes/timesheets.js — Daily & Monthly Timesheet Entry with Project-Wise Hours
const express = require("express");
const db = require("../db");
const { authRequired, adminOnly } = require("../middleware/auth");
const router = express.Router();

const STANDARD_DAY_HOURS = 9;

function canEditMember(req, memberId) {
  return req.user.role === "admin" || String(req.user.member_id) === String(memberId);
}

// GET /api/timesheets/admin — Admin overview of team project-wise timesheet hours
router.get("/admin", authRequired, adminOnly, async (req, res) => {
  try {
    const month = req.query.month || new Date().toISOString().slice(0, 7);
    const memberFilter = req.query.member_id ? parseInt(req.query.member_id, 10) : null;
    const projectFilter = req.query.project_id ? parseInt(req.query.project_id, 10) : null;
    const clientFilter = req.query.client_id ? parseInt(req.query.client_id, 10) : null;

    // Fetch members, projects, clients for filter dropdowns
    const [membersRes, projectsRes, clientsRes, holidaysRes, leavesRes] = await Promise.all([
      db.query("SELECT id, name, designation, order_index, active, rate FROM members WHERE active = 1 ORDER BY order_index, id"),
      db.query("SELECT id, project_no, name, abbr, active, client_id FROM projects WHERE active = 1 ORDER BY project_no, id"),
      db.query("SELECT id, name FROM clients WHERE active = 1 ORDER BY name ASC"),
      db.query("SELECT * FROM holidays WHERE date LIKE $1 ORDER BY date ASC", [`${month}%`]),
      db.query("SELECT * FROM leaves WHERE date LIKE $1 ORDER BY date ASC", [`${month}%`]),
    ]);

    // Fetch all timesheet entries for this month
    let entriesSql = `
      SELECT te.id, te.member_id, te.project_id, te.date, te.hours, te.narration, te.task_id,
             m.name as member_name, m.order_index,
             p.project_no, p.name as project_name, p.abbr as project_abbr, p.client_id
      FROM timesheet_entries te
      JOIN members m ON m.id = te.member_id
      JOIN projects p ON p.id = te.project_id
      WHERE te.date LIKE $1
    `;
    const entriesParams = [`${month}%`];
    if (memberFilter) {
      entriesParams.push(memberFilter);
      entriesSql += ` AND te.member_id = $${entriesParams.length}`;
    }
    if (projectFilter) {
      entriesParams.push(projectFilter);
      entriesSql += ` AND te.project_id = $${entriesParams.length}`;
    }
    if (clientFilter) {
      entriesParams.push(clientFilter);
      entriesSql += ` AND p.client_id = $${entriesParams.length}`;
    }
    entriesSql += " ORDER BY m.order_index, m.id, p.project_no, p.id, te.date";
    const entriesRes = await db.query(entriesSql, entriesParams);

    // Fetch all assigned project_members so rows appear even with 0 logged hours
    let assignedSql = `
      SELECT pm.member_id, m.name as member_name, m.order_index,
             pm.project_id, p.project_no, p.name as project_name, p.abbr as project_abbr, p.client_id
      FROM project_members pm
      JOIN members m ON m.id = pm.member_id
      JOIN projects p ON p.id = pm.project_id
      WHERE m.active = 1 AND p.active = 1
    `;
    const assignedParams = [];
    if (memberFilter) {
      assignedParams.push(memberFilter);
      assignedSql += ` AND pm.member_id = $${assignedParams.length}`;
    }
    if (projectFilter) {
      assignedParams.push(projectFilter);
      assignedSql += ` AND pm.project_id = $${assignedParams.length}`;
    }
    if (clientFilter) {
      assignedParams.push(clientFilter);
      assignedSql += ` AND p.client_id = $${assignedParams.length}`;
    }
    assignedSql += " ORDER BY m.order_index, m.id, p.project_no, p.id";
    const assignedRes = await db.query(assignedSql, assignedParams);

    // Build row definitions (unique member + project)
    const rowMap = new Map();
    assignedRes.rows.forEach((r) => {
      const key = `${r.member_id}_${r.project_id}`;
      rowMap.set(key, {
        member_id: r.member_id,
        member_name: r.member_name,
        order_index: r.order_index,
        project_id: r.project_id,
        project_no: r.project_no,
        project_name: r.project_name,
        project_abbr: r.project_abbr,
        daily_hours: {},
        narrations: {},
        total_hours: 0,
      });
    });

    entriesRes.rows.forEach((e) => {
      const key = `${e.member_id}_${e.project_id}`;
      if (!rowMap.has(key)) {
        rowMap.set(key, {
          member_id: e.member_id,
          member_name: e.member_name,
          order_index: e.order_index,
          project_id: e.project_id,
          project_no: e.project_no,
          project_name: e.project_name,
          project_abbr: e.project_abbr,
          daily_hours: {},
          narrations: {},
          total_hours: 0,
        });
      }
      const row = rowMap.get(key);
      const h = parseFloat(e.hours) || 0;
      row.daily_hours[e.date] = h;
      if (e.narration) row.narrations[e.date] = e.narration;
      row.total_hours = Math.round((row.total_hours + h) * 100) / 100;
    });

    const rows = Array.from(rowMap.values()).sort((a, b) => {
      if (a.order_index !== b.order_index) return (a.order_index || 0) - (b.order_index || 0);
      const nameComp = (a.member_name || "").localeCompare(b.member_name || "");
      if (nameComp !== 0) return nameComp;
      return (a.project_no || "").localeCompare(b.project_no || "");
    });

    // Calculate aggregated daily, employee, and project totals
    const dailyTotals = {};
    const employeeTotalsMap = new Map();
    const projectTotalsMap = new Map();
    let grandTotal = 0;

    rows.forEach((row) => {
      // Employee totals
      if (!employeeTotalsMap.has(row.member_id)) {
        employeeTotalsMap.set(row.member_id, {
          member_id: row.member_id,
          member_name: row.member_name,
          total_hours: 0,
          project_count: 0,
        });
      }
      const emp = employeeTotalsMap.get(row.member_id);
      emp.total_hours = Math.round((emp.total_hours + row.total_hours) * 100) / 100;
      if (row.total_hours > 0) emp.project_count += 1;

      // Project totals
      if (!projectTotalsMap.has(row.project_id)) {
        projectTotalsMap.set(row.project_id, {
          project_id: row.project_id,
          project_no: row.project_no,
          project_name: row.project_name,
          project_abbr: row.project_abbr,
          total_hours: 0,
          member_count: 0,
        });
      }
      const prj = projectTotalsMap.get(row.project_id);
      prj.total_hours = Math.round((prj.total_hours + row.total_hours) * 100) / 100;
      if (row.total_hours > 0) prj.member_count += 1;

      // Daily totals
      Object.entries(row.daily_hours).forEach(([d, h]) => {
        dailyTotals[d] = Math.round(((dailyTotals[d] || 0) + h) * 100) / 100;
      });
      grandTotal = Math.round((grandTotal + row.total_hours) * 100) / 100;
    });

    res.json({
      month,
      members: membersRes.rows,
      projects: projectsRes.rows,
      clients: clientsRes.rows,
      holidays: holidaysRes.rows,
      leaves: leavesRes.rows,
      rows,
      summary: {
        grand_total: grandTotal,
        daily_totals: dailyTotals,
        employee_totals: Array.from(employeeTotalsMap.values()),
        project_totals: Array.from(projectTotalsMap.values()).filter((p) => p.total_hours > 0 || projectFilter),
      },
    });
  } catch (err) {
    console.error("Admin timesheet fetch error:", err);
    res.status(500).json({ error: "Failed to fetch admin timesheets" });
  }
});

// GET /api/timesheets or /api/timesheets/monthly — full project-wise monthly timesheet dataset
async function getMonthlyTimesheetData(req, res) {
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

    // Also get projects where member has logged hours in this month (so historical logged hours are preserved)
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
}

router.get("/", authRequired, getMonthlyTimesheetData);
router.get("/monthly", authRequired, getMonthlyTimesheetData);

// Save individual project date hour cell handler (with strict project assignment verification)
async function handleSaveTimesheetHour(req, res) {
  let { member_id, project_id, date, hours, narration } = req.body || {};

  // Employees can only edit their own hours
  if (req.user.role !== "admin") {
    member_id = req.user.member_id;
  } else if (!member_id) {
    member_id = req.user.member_id;
  }

  if (!member_id) {
    return res.status(400).json({ error: "No team member linked to this user account" });
  }

  if (!project_id || !date) {
    return res.status(400).json({ error: "project_id and date are required" });
  }

  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return res.status(400).json({ error: "Invalid date format. Expected YYYY-MM-DD" });
  }

  const numHours = parseFloat(hours);
  if (isNaN(numHours) || numHours < 0 || numHours > 24) {
    return res.status(400).json({ error: "Hours must be a number between 0 and 24" });
  }

  // Security Check: Verify employee is assigned to this project
  if (req.user.role !== "admin") {
    const isAssigned = await db.query(
      "SELECT 1 FROM project_members WHERE project_id = $1 AND member_id = $2",
      [project_id, member_id]
    );
    if (!isAssigned.rows.length) {
      return res.status(403).json({ error: "Forbidden: You are not assigned to this project." });
    }
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
}

// Support PUT, PATCH, and POST for saving individual timesheet hour cells
router.put("/", authRequired, handleSaveTimesheetHour);
router.patch("/", authRequired, handleSaveTimesheetHour);
router.post("/", authRequired, handleSaveTimesheetHour);
router.post("/save-cell", authRequired, handleSaveTimesheetHour);

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
