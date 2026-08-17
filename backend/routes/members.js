// backend/routes/members.js — Team Members, Ordering & Rates Management
const express = require("express");
const db = require("../db");
const { authRequired, adminOnly } = require("../middleware/auth");
const router = express.Router();

// GET /api/members — list active team members
router.get("/", authRequired, async (req, res) => {
  try {
    const { rows } = await db.query(
      "SELECT id, name, order_index, active, rate FROM members WHERE active = 1 ORDER BY order_index, id"
    );
    res.json(rows);
  } catch (err) {
    console.error("Fetch members error:", err);
    res.status(500).json({ error: "Failed to fetch team members" });
  }
});

// POST /api/members — admin only
router.post("/", authRequired, adminOnly, async (req, res) => {
  const { name } = req.body || {};
  if (!name || !name.trim()) return res.status(400).json({ error: "Name is required" });

  try {
    const maxRes = await db.query("SELECT COALESCE(MAX(order_index), -1) as m FROM members");
    const maxOrder = maxRes.rows[0].m;
    const { rows } = await db.query(
      "INSERT INTO members (name, order_index) VALUES ($1, $2) RETURNING id",
      [name.trim(), maxOrder + 1]
    );
    res.json({ id: rows[0].id });
  } catch (err) {
    console.error("Create member error:", err);
    res.status(500).json({ error: "Failed to create team member" });
  }
});

// PUT /api/members/:id — rename member (admin only)
router.put("/:id", authRequired, adminOnly, async (req, res) => {
  const { name } = req.body || {};
  if (!name || !name.trim()) return res.status(400).json({ error: "Name is required" });

  try {
    await db.query("UPDATE members SET name = $1 WHERE id = $2", [name.trim(), req.params.id]);
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
