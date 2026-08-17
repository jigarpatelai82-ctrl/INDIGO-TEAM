// backend/routes/summary.js — Monthly Attendance & Project Utilization Summaries
const express = require("express");
const db = require("../db");
const { authRequired } = require("../middleware/auth");
const router = express.Router();

// GET /api/summary/month?month=YYYY-MM
router.get("/month", authRequired, async (req, res) => {
  const { month } = req.query;
  if (!month) {
    return res.status(400).json({ error: "Month parameter is required (format: YYYY-MM)" });
  }

  try {
    const members = (
      await db.query(
        "SELECT id, name, order_index, rate FROM members WHERE active = 1 ORDER BY order_index, id"
      )
    ).rows;

    const leaves = (
      await db.query("SELECT * FROM leaves WHERE date LIKE $1", [`${month}%`])
    ).rows;

    const holidays = (
      await db.query("SELECT * FROM holidays WHERE date LIKE $1 ORDER BY date ASC", [`${month}%`])
    ).rows;

    const entries = (
      await db.query(
        `SELECT te.*, p.abbr, p.project_no
         FROM timesheet_entries te
         JOIN projects p ON p.id = te.project_id
         WHERE te.date LIKE $1`,
        [`${month}%`]
      )
    ).rows;

    const days = (
      await db.query("SELECT * FROM timesheet_days WHERE date LIKE $1", [`${month}%`])
    ).rows;

    res.json({ members, leaves, holidays, entries, days });
  } catch (err) {
    console.error("Fetch month summary error:", err);
    res.status(500).json({ error: "Failed to fetch monthly summary data" });
  }
});

// GET /api/summary/projects?month=YYYY-MM
router.get("/projects", authRequired, async (req, res) => {
  const { month } = req.query;
  try {
    const projects = (await db.query("SELECT * FROM projects WHERE active = 1 ORDER BY id")).rows;
    const result = [];

    for (const p of projects) {
      const members = (
        await db.query(
          `SELECT m.id, m.name, m.rate
           FROM project_members pm
           JOIN members m ON m.id = pm.member_id
           WHERE pm.project_id = $1`,
          [p.id]
        )
      ).rows;

      const rated = members.filter((m) => m.rate > 0);
      const avgRate = rated.length ? rated.reduce((a, m) => a + m.rate, 0) / rated.length : 0;
      const availableHours =
        p.manual_hours > 0 ? p.manual_hours : p.fee && avgRate ? p.fee / avgRate : 0;

      const totalUsedRes = await db.query(
        "SELECT COALESCE(SUM(hours), 0) h FROM timesheet_entries WHERE project_id = $1",
        [p.id]
      );
      const totalUsed = parseFloat(totalUsedRes.rows[0].h || "0");

      let monthUsed = 0;
      let monthCost = 0;

      if (month) {
        const monthUsedRes = await db.query(
          "SELECT COALESCE(SUM(hours), 0) h FROM timesheet_entries WHERE project_id = $1 AND date LIKE $2",
          [p.id, `${month}%`]
        );
        monthUsed = parseFloat(monthUsedRes.rows[0].h || "0");

        const monthCostRes = await db.query(
          `SELECT COALESCE(SUM(te.hours * m.rate), 0) c
           FROM timesheet_entries te
           JOIN members m ON m.id = te.member_id
           WHERE te.project_id = $1 AND te.date LIKE $2`,
          [p.id, `${month}%`]
        );
        monthCost = parseFloat(monthCostRes.rows[0].c || "0");
      }

      const remaining = availableHours - totalUsed;
      const usagePct = availableHours > 0 ? (totalUsed / availableHours) * 100 : 0;

      let status = "green";
      if (usagePct > 75) status = "red";
      else if (usagePct > 50) status = "yellow";

      result.push({
        id: p.id,
        project_no: p.project_no,
        abbr: p.abbr,
        name: p.name,
        month_hours: monthUsed,
        total_used: totalUsed,
        available_hours: availableHours,
        remaining_hours: remaining,
        usage_pct: usagePct,
        month_cost: monthCost,
        status,
      });
    }

    res.json(result);
  } catch (err) {
    console.error("Fetch project summary error:", err);
    res.status(500).json({ error: "Failed to fetch project utilization summary" });
  }
});

module.exports = router;
