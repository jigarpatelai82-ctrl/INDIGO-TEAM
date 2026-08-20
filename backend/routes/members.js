// backend/routes/members.js — Team Members, Ordering & Rates Management
const express = require("express");
const db = require("../db");
const { authRequired, adminOnly } = require("../middleware/auth");
const router = express.Router();

// GET /api/members — list active team members (or all if admin requested)
router.get("/", authRequired, async (req, res) => {
  try {
    const showAll = req.query.all === "1" && req.user.role === "admin";
    const sql = showAll
      ? "SELECT id, name, designation, email, order_index, active, rate FROM members ORDER BY order_index, id"
      : "SELECT id, name, designation, email, order_index, active, rate FROM members WHERE active = 1 ORDER BY order_index, id";
    const { rows } = await db.query(sql);
    res.json(rows);
  } catch (err) {
    console.error("Fetch members error:", err);
    res.status(500).json({ error: "Failed to fetch team members" });
  }
});

// POST /api/members — admin only
router.post("/", authRequired, adminOnly, async (req, res) => {
  const { name, designation, rate, email, active } = req.body || {};
  if (!name || !name.trim()) return res.status(400).json({ error: "Name is required" });
  if (!designation || !designation.trim()) return res.status(400).json({ error: "Designation is required" });
  const parsedRate = rate !== undefined ? parseFloat(rate) : 0;
  if (isNaN(parsedRate) || parsedRate < 0) {
    return res.status(400).json({ error: "Man-Hour Rate must be a non-negative number" });
  }

  try {
    const maxRes = await db.query("SELECT COALESCE(MAX(order_index), -1) as m FROM members");
    const maxOrder = maxRes.rows[0].m;
    const { rows } = await db.query(
      `INSERT INTO members (name, designation, rate, email, active, order_index)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
      [
        name.trim(),
        designation.trim(),
        parsedRate,
        email ? email.trim() : "",
        active === 0 || active === false ? 0 : 1,
        maxOrder + 1,
      ]
    );
    res.json({ id: rows[0].id });
  } catch (err) {
    console.error("Create member error:", err);
    res.status(500).json({ error: "Failed to create team member" });
  }
});

// PUT /api/members/:id — update member (admin only)
router.put("/:id", authRequired, adminOnly, async (req, res) => {
  const { name, designation, rate, email, active } = req.body || {};
  if (name !== undefined && !name.trim()) return res.status(400).json({ error: "Name cannot be empty" });
  if (designation !== undefined && !designation.trim()) return res.status(400).json({ error: "Designation cannot be empty" });
  if (rate !== undefined && (isNaN(parseFloat(rate)) || parseFloat(rate) < 0)) {
    return res.status(400).json({ error: "Man-Hour Rate must be a non-negative number" });
  }

  try {
    const { rows: existingRows } = await db.query("SELECT * FROM members WHERE id = $1", [req.params.id]);
    const m = existingRows[0];
    if (!m) return res.status(404).json({ error: "Team member not found" });

    const newName = name !== undefined ? name.trim() : m.name;
    const newDesignation = designation !== undefined ? designation.trim() : (m.designation || "Team Member");
    const newRate = rate !== undefined ? parseFloat(rate) : (m.rate || 0);
    const newEmail = email !== undefined ? email.trim() : (m.email || "");
    const newActive = active !== undefined ? (active === 0 || active === false ? 0 : 1) : m.active;

    await db.query(
      `UPDATE members
       SET name = $1, designation = $2, rate = $3, email = $4, active = $5
       WHERE id = $6`,
      [newName, newDesignation, newRate, newEmail, newActive, m.id]
    );
    res.json({ ok: true });
  } catch (err) {
    console.error("Update member error:", err);
    res.status(500).json({ error: "Failed to update team member" });
  }
});

// PUT /api/members/reorder/all — update member display order (admin only)
router.put("/reorder/all", authRequired, adminOnly, async (req, res) => {
  const { order } = req.body || {};
  if (!Array.isArray(order)) return res.status(400).json({ error: "Order array required" });

  try {
    for (let i = 0; i < order.length; i++) {
      await db.query("UPDATE members SET order_index = $1 WHERE id = $2", [i, order[i]]);
    }
    res.json({ ok: true });
  } catch (err) {
    console.error("Reorder members error:", err);
    res.status(500).json({ error: "Failed to reorder team members" });
  }
});

// DELETE /api/members/:id — soft delete (preserves historical data)
router.delete("/:id", authRequired, adminOnly, async (req, res) => {
  try {
    await db.query("UPDATE members SET active = 0 WHERE id = $1", [req.params.id]);
    res.json({ ok: true });
  } catch (err) {
    console.error("Deactivate member error:", err);
    res.status(500).json({ error: "Failed to deactivate team member" });
  }
});

// PUT /api/members/:id/rate — set hourly rate for project cost calculations (admin only)
router.put("/:id/rate", authRequired, adminOnly, async (req, res) => {
  const { rate } = req.body || {};
  try {
    await db.query("UPDATE members SET rate = $1 WHERE id = $2", [+rate || 0, req.params.id]);
    res.json({ ok: true });
  } catch (err) {
    console.error("Update member rate error:", err);
    res.status(500).json({ error: "Failed to update hourly rate" });
  }
});

module.exports = router;
