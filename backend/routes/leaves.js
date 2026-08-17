// backend/routes/leaves.js — Attendance, Leaves & Holiday Management
const express = require("express");
const db = require("../db");
const { authRequired } = require("../middleware/auth");
const router = express.Router();

function canEditMember(req, memberId) {
  return req.user.role === "admin" || String(req.user.member_id) === String(memberId);
}

// GET /api/leaves
router.get("/", authRequired, async (req, res) => {
  const { month } = req.query;
  try {
    const { rows } = month
      ? await db.query("SELECT * FROM leaves WHERE date LIKE $1", [`${month}%`])
      : await db.query("SELECT * FROM leaves");
    res.json(rows);
  } catch (err) {
    console.error("Fetch leaves error:", err);
    res.status(500).json({ error: "Failed to fetch leave records" });
  }
});

// POST /api/leaves — date range leave booking
router.post("/", authRequired, async (req, res) => {
  const { member_id, from, to, status, remarks } = req.body || {};
  if (!member_id || !from || !to) {
    return res.status(400).json({ error: "member_id, from date, and to date are required" });
  }
  if (!canEditMember(req, member_id)) {
    return res.status(403).json({ error: "Can only manage your own leave records" });
  }

  // Parse YYYY-MM-DD cleanly
  const start = new Date(from + "T00:00:00Z");
  const end = new Date(to + "T00:00:00Z");
  if (start > end) {
    return res.status(400).json({ error: "From date must be before or equal to To date" });
  }

  try {
    for (let d = new Date(start); d <= end; d.setUTCDate(d.getUTCDate() + 1)) {
      const ds = d.toISOString().slice(0, 10);
      await db.query("DELETE FROM leaves WHERE member_id = $1 AND date = $2", [member_id, ds]);
      if (status && status !== "Working-Day") {
        await db.query(
          "INSERT INTO leaves (member_id, date, status, remarks) VALUES ($1, $2, $3, $4)",
          [member_id, ds, status, remarks || ""]
        );
      }
    }
    res.json({ ok: true });
  } catch (err) {
    console.error("Save leave range error:", err);
    res.status(500).json({ error: "Failed to record leave" });
  }
});

// PUT /api/leaves/cell — single day cell update
router.put("/cell", authRequired, async (req, res) => {
  const { member_id, date, status, remarks } = req.body || {};
  if (!member_id || !date) {
    return res.status(400).json({ error: "member_id and date are required" });
  }
  if (!canEditMember(req, member_id)) {
    return res.status(403).json({ error: "Can only manage your own leave records" });
  }

  try {
    await db.query("DELETE FROM leaves WHERE member_id = $1 AND date = $2", [member_id, date]);
    if (status && status !== "Working-Day") {
      await db.query(
        "INSERT INTO leaves (member_id, date, status, remarks) VALUES ($1, $2, $3, $4)",
        [member_id, date, status, remarks || ""]
      );
    }
    res.json({ ok: true });
  } catch (err) {
    console.error("Update leave cell error:", err);
    res.status(500).json({ error: "Failed to update leave cell" });
  }
});

// GET /api/leaves/holidays/all
router.get("/holidays/all", authRequired, async (req, res) => {
  try {
    const { rows } = await db.query("SELECT * FROM holidays ORDER BY date ASC");
    res.json(rows);
  } catch (err) {
    console.error("Fetch holidays error:", err);
    res.status(500).json({ error: "Failed to fetch holidays" });
  }
});

// POST /api/leaves/holidays — admin only
router.post("/holidays", authRequired, async (req, res) => {
  if (req.user.role !== "admin") return res.status(403).json({ error: "Admin access required" });
  const { date, name, remarks } = req.body || {};
  if (!date || !name) return res.status(400).json({ error: "Holiday date and name are required" });

  try {
    await db.query(
      `INSERT INTO holidays (date, name, remarks) VALUES ($1, $2, $3)
       ON CONFLICT (date) DO UPDATE SET name = EXCLUDED.name, remarks = EXCLUDED.remarks`,
      [date, name.trim(), remarks || ""]
    );
    res.json({ ok: true });
  } catch (err) {
    console.error("Save holiday error:", err);
    res.status(500).json({ error: "Failed to save holiday" });
  }
});

// DELETE /api/leaves/holidays/:date — admin only
router.delete("/holidays/:date", authRequired, async (req, res) => {
  if (req.user.role !== "admin") return res.status(403).json({ error: "Admin access required" });
  try {
    await db.query("DELETE FROM holidays WHERE date = $1", [req.params.date]);
    res.json({ ok: true });
  } catch (err) {
    console.error("Delete holiday error:", err);
    res.status(500).json({ error: "Failed to delete holiday" });
  }
});

module.exports = router;
