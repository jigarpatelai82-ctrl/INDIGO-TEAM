// backend/routes/clients.js — Client Organization Entity Management
const express = require("express");
const db = require("../db");
const { authRequired, adminOnly } = require("../middleware/auth");
const router = express.Router();

// GET /api/clients — all authenticated users can view client names for dropdowns
router.get("/", authRequired, async (req, res) => {
  try {
    const { rows } = await db.query("SELECT * FROM clients WHERE active = 1 ORDER BY name");
    res.json(rows);
  } catch (err) {
    console.error("Fetch clients error:", err);
    res.status(500).json({ error: "Failed to fetch clients" });
  }
});

// GET /api/clients/:id — client detail with associated projects
router.get("/:id", authRequired, async (req, res) => {
  try {
    const { rows } = await db.query("SELECT * FROM clients WHERE id = $1", [req.params.id]);
    if (!rows[0]) return res.status(404).json({ error: "Client not found" });

    const projects = (
      await db.query(
        "SELECT id, project_no, abbr, name, fee FROM projects WHERE client_id = $1 AND active = 1",
        [req.params.id]
      )
    ).rows;

    res.json({ ...rows[0], projects });
  } catch (err) {
    console.error("Fetch client detail error:", err);
    res.status(500).json({ error: "Failed to fetch client details" });
  }
});

// POST /api/clients — admin only
router.post("/", authRequired, adminOnly, async (req, res) => {
  const { name, contact_person, email, phone, address, remarks } = req.body || {};
  if (!name || !name.trim()) {
    return res.status(400).json({ error: "Client name is required" });
  }

  try {
    const { rows } = await db.query(
      `INSERT INTO clients (name, contact_person, email, phone, address, remarks)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
      [name.trim(), contact_person || "", email || "", phone || "", address || "", remarks || ""]
    );
    res.json({ id: rows[0].id });
  } catch (err) {
    console.error("Create client error:", err);
    res.status(500).json({ error: "Failed to create client" });
  }
});

// PUT /api/clients/:id — admin only
router.put("/:id", authRequired, adminOnly, async (req, res) => {
  const { name, contact_person, email, phone, address, remarks } = req.body || {};
  try {
    const { rows } = await db.query("SELECT * FROM clients WHERE id = $1", [req.params.id]);
    const c = rows[0];
    if (!c) return res.status(404).json({ error: "Client not found" });
    if (!name || !name.trim()) return res.status(400).json({ error: "Client name is required" });

    await db.query(
      `UPDATE clients SET name = $1, contact_person = $2, email = $3, phone = $4, address = $5, remarks = $6 WHERE id = $7`,
      [
        name.trim(),
        contact_person !== undefined ? contact_person : c.contact_person,
        email !== undefined ? email : c.email,
        phone !== undefined ? phone : c.phone,
        address !== undefined ? address : c.address,
        remarks !== undefined ? remarks : c.remarks,
        c.id,
      ]
    );
    res.json({ ok: true });
  } catch (err) {
    console.error("Update client error:", err);
    res.status(500).json({ error: "Failed to update client" });
  }
});

// DELETE /api/clients/:id — soft delete (preserves historical linkage)
router.delete("/:id", authRequired, adminOnly, async (req, res) => {
  try {
    await db.query("UPDATE clients SET active = 0 WHERE id = $1", [req.params.id]);
    res.json({ ok: true });
  } catch (err) {
    console.error("Deactivate client error:", err);
    res.status(500).json({ error: "Failed to deactivate client" });
  }
});

module.exports = router;
