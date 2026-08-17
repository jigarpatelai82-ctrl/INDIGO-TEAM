// backend/routes/search.js — Scoped Global Search
const express = require("express");
const db = require("../db");
const { authRequired } = require("../middleware/auth");
const router = express.Router();

// GET /api/search?q=... — global search across projects, clients, team, and tasks
router.get("/", authRequired, async (req, res) => {
  const q = (req.query.q || "").trim();
  if (!q || q.length < 2) {
    return res.json({ projects: [], clients: [], members: [], tasks: [] });
  }

  const like = `%${q}%`;

  try {
    const projects = (
      await db.query(
        `SELECT id, project_no, abbr, name
         FROM projects
         WHERE active = 1 AND (project_no ILIKE $1 OR abbr ILIKE $1 OR name ILIKE $1)
         ORDER BY name LIMIT 6`,
        [like]
      )
    ).rows;

    let clients = [];
    let members = [];
    let tasks = [];

    if (req.user.role === "admin") {
      clients = (
        await db.query(
          `SELECT id, name, contact_person, email
           FROM clients
           WHERE active = 1 AND (name ILIKE $1 OR contact_person ILIKE $1 OR email ILIKE $1)
           ORDER BY name LIMIT 6`,
          [like]
        )
      ).rows;

      members = (
        await db.query(
          `SELECT id, name FROM members WHERE active = 1 AND name ILIKE $1 ORDER BY name LIMIT 6`,
          [like]
        )
      ).rows;

      tasks = (
        await db.query(
          `SELECT t.id, t.title, t.status, m.name as member_name
           FROM tasks t
           JOIN members m ON m.id = t.assigned_to
           WHERE t.title ILIKE $1 ORDER BY t.created_at DESC LIMIT 8`,
          [like]
        )
      ).rows;
    } else if (req.user.member_id) {
      tasks = (
        await db.query(
          `SELECT t.id, t.title, t.status, m.name as member_name
           FROM tasks t
           JOIN members m ON m.id = t.assigned_to
           WHERE t.assigned_to = $2 AND t.title ILIKE $1 ORDER BY t.created_at DESC LIMIT 8`,
          [like, req.user.member_id]
        )
      ).rows;
    }

    res.json({ projects, clients, members, tasks });
  } catch (err) {
    console.error("Global search error:", err);
    res.status(500).json({ error: "Failed to perform search" });
  }
});

module.exports = router;
