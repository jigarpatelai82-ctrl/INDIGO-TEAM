// backend/routes/projects.js — Project Portfolio & Manhour Budgeting
const express = require("express");
const db = require("../db");
const { authRequired, adminOnly } = require("../middleware/auth");
const router = express.Router();

async function enrichProject(p) {
  const memRes = await db.query(
    `SELECT m.id, m.name, m.rate
     FROM project_members pm
     JOIN members m ON m.id = pm.member_id
     WHERE pm.project_id = $1`,
    [p.id]
  );
  const members = memRes.rows;
  const rated = members.filter((m) => m.rate > 0);
  const avgRate = rated.length ? rated.reduce((a, m) => a + m.rate, 0) / rated.length : 0;
  const calcHours = p.fee && avgRate ? p.fee / avgRate : 0;
  const availableHours = p.manual_hours > 0 ? p.manual_hours : calcHours;

  const usedRes = await db.query(
    "SELECT COALESCE(SUM(hours), 0) as h FROM timesheet_entries WHERE project_id = $1",
    [p.id]
  );
  const used = parseFloat(usedRes.rows[0].h || "0");
  const usagePct = availableHours > 0 ? (used / availableHours) * 100 : 0;

  let status = "green";
  if (usagePct > 75) status = "red";
  else if (usagePct > 50) status = "yellow";

  let client_name = null;
  if (p.client_id) {
    const c = await db.query("SELECT name FROM clients WHERE id = $1", [p.client_id]);
    client_name = c.rows[0]?.name || null;
  }

  return {
    ...p,
    members,
    avg_rate: avgRate,
    calculated_hours: calcHours,
    available_hours: availableHours,
    used_hours: used,
    usage_pct: usagePct,
    status,
    client_name,
  };
}

// GET /api/projects — list projects with enriched budget analytics
router.get("/", authRequired, async (req, res) => {
  try {
    const { rows } = await db.query("SELECT * FROM projects WHERE active = 1 ORDER BY id");
    const enriched = await Promise.all(rows.map(enrichProject));
    res.json(enriched);
  } catch (err) {
    console.error("Fetch projects error:", err);
    res.status(500).json({ error: "Failed to fetch projects" });
  }
});

// GET /api/projects/:id — get single project
router.get("/:id", authRequired, async (req, res) => {
  try {
    const { rows } = await db.query("SELECT * FROM projects WHERE id = $1", [req.params.id]);
    if (!rows[0]) return res.status(404).json({ error: "Project not found" });
    res.json(await enrichProject(rows[0]));
  } catch (err) {
    console.error("Fetch project detail error:", err);
    res.status(500).json({ error: "Failed to fetch project detail" });
  }
});

// POST /api/projects — admin only
router.post("/", authRequired, adminOnly, async (req, res) => {
  const { project_no, abbr, name, fee, manual_hours, remarks, member_ids, client_id } = req.body || {};
  if (!project_no || !abbr || !name) {
    return res.status(400).json({ error: "Project number, abbreviation, and name are required" });
  }

  try {
    const { rows } = await db.query(
      `INSERT INTO projects (project_no, abbr, name, fee, manual_hours, remarks, client_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
      [
        project_no.trim(),
        abbr.trim(),
        name.trim(),
        parseFloat(fee) || 0,
        parseFloat(manual_hours) || 0,
        remarks || "",
        client_id || null,
      ]
    );
    const pid = rows[0].id;

    if (Array.isArray(member_ids)) {
      for (const mid of member_ids) {
        await db.query(
          "INSERT INTO project_members (project_id, member_id) VALUES ($1, $2) ON CONFLICT DO NOTHING",
          [pid, mid]
        );
      }
    }

    res.json({ id: pid });
  } catch (err) {
    console.error("Create project error:", err);
    res.status(500).json({ error: "Failed to create project" });
  }
});

// PUT /api/projects/:id — admin only
router.put("/:id", authRequired, adminOnly, async (req, res) => {
  const { project_no, abbr, name, fee, manual_hours, remarks, member_ids, client_id } = req.body || {};
  try {
    const { rows } = await db.query("SELECT * FROM projects WHERE id = $1", [req.params.id]);
    const p = rows[0];
    if (!p) return res.status(404).json({ error: "Project not found" });

    await db.query(
      `UPDATE projects
       SET project_no = $1, abbr = $2, name = $3, fee = $4, manual_hours = $5, remarks = $6, client_id = $7
       WHERE id = $8`,
      [
        project_no !== undefined ? project_no.trim() : p.project_no,
        abbr !== undefined ? abbr.trim() : p.abbr,
        name !== undefined ? name.trim() : p.name,
        fee !== undefined ? parseFloat(fee) : p.fee,
        manual_hours !== undefined ? parseFloat(manual_hours) : p.manual_hours,
        remarks !== undefined ? remarks : p.remarks,
        client_id !== undefined ? client_id || null : p.client_id,
        p.id,
      ]
    );

    if (Array.isArray(member_ids)) {
      await db.query("DELETE FROM project_members WHERE project_id = $1", [p.id]);
      for (const mid of member_ids) {
        await db.query(
          "INSERT INTO project_members (project_id, member_id) VALUES ($1, $2) ON CONFLICT DO NOTHING",
          [p.id, mid]
        );
      }
    }

    res.json({ ok: true });
  } catch (err) {
    console.error("Update project error:", err);
    res.status(500).json({ error: "Failed to update project" });
  }
});

// DELETE /api/projects/:id — soft delete (admin only)
router.delete("/:id", authRequired, adminOnly, async (req, res) => {
  try {
    await db.query("UPDATE projects SET active = 0 WHERE id = $1", [req.params.id]);
    res.json({ ok: true });
  } catch (err) {
    console.error("Deactivate project error:", err);
    res.status(500).json({ error: "Failed to deactivate project" });
  }
});

module.exports = router;
