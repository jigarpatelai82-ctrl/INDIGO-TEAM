// backend/routes/auth.js — Authentication & User Administration
const express = require("express");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const db = require("../db");
const { authRequired, adminOnly, getSecret } = require("../middleware/auth");
const router = express.Router();

async function logAudit(userId, action, detail) {
  try {
    await db.query(
      "INSERT INTO audit_log (user_id, action, detail) VALUES ($1, $2, $3)",
      [userId || null, action, detail ? JSON.stringify(detail) : null]
    );
  } catch (err) {
    console.error("Audit log error:", err.message);
  }
}

// POST /api/auth/login
router.post("/login", async (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) {
    return res.status(400).json({ error: "Username and password are required" });
  }

  try {
    const { rows } = await db.query(
      "SELECT * FROM users WHERE username = $1 AND active = 1",
      [username.trim()]
    );
    const user = rows[0];

    if (!user || !bcrypt.compareSync(password, user.password_hash)) {
      return res.status(401).json({ error: "Invalid username or password" });
    }

    let member = null;
    if (user.member_id) {
      const m = await db.query("SELECT id, name FROM members WHERE id = $1", [user.member_id]);
      member = m.rows[0] || null;
    }

    const token = jwt.sign(
      {
        id: user.id,
        username: user.username,
        role: user.role,
        member_id: user.member_id,
      },
      getSecret(),
      { expiresIn: "12h" }
    );

    await logAudit(user.id, "login", { username: user.username });

    res.json({
      token,
      user: {
        id: user.id,
        username: user.username,
        role: user.role,
        member_id: user.member_id,
        member_name: member?.name || null,
        must_change_password: !!user.must_change_password,
      },
    });
  } catch (err) {
    console.error("Login error:", err);
    res.status(500).json({ error: "Login failed due to server error" });
  }
});

// POST /api/auth/change-password
router.post("/change-password", authRequired, async (req, res) => {
  const { current_password, new_password } = req.body || {};
  if (!new_password || new_password.length < 4) {
    return res.status(400).json({ error: "New password too short (minimum 4 characters)" });
  }

  try {
    const { rows } = await db.query("SELECT * FROM users WHERE id = $1", [req.user.id]);
    const user = rows[0];
    if (!user) return res.status(404).json({ error: "User not found" });

    if (!bcrypt.compareSync(current_password || "", user.password_hash)) {
      return res.status(401).json({ error: "Current password is incorrect" });
    }

    const hash = bcrypt.hashSync(new_password, 10);
    await db.query(
      "UPDATE users SET password_hash = $1, must_change_password = 0 WHERE id = $2",
      [hash, user.id]
    );

    await logAudit(user.id, "change_password");
    res.json({ ok: true });
  } catch (err) {
    console.error("Password change error:", err);
    res.status(500).json({ error: "Failed to update password" });
  }
});

// GET /api/auth/me
router.get("/me", authRequired, async (req, res) => {
  try {
    const { rows } = await db.query(
      "SELECT id, username, role, member_id, must_change_password FROM users WHERE id = $1",
      [req.user.id]
    );
    const user = rows[0];
    if (!user) return res.status(404).json({ error: "User not found" });

    let member = null;
    if (user.member_id) {
      const m = await db.query("SELECT id, name FROM members WHERE id = $1", [user.member_id]);
      member = m.rows[0] || null;
    }

    res.json({ ...user, member_name: member?.name || null });
  } catch (err) {
    console.error("Fetch profile error:", err);
    res.status(500).json({ error: "Failed to fetch user profile" });
  }
});

// GET /api/auth/users
router.get("/users", authRequired, adminOnly, async (req, res) => {
  try {
    const { rows } = await db.query(`
      SELECT u.id, u.username, u.role, u.member_id, u.email, u.active, u.must_change_password, m.name as member_name
      FROM users u LEFT JOIN members m ON m.id = u.member_id
      ORDER BY u.id
    `);
    res.json(rows);
  } catch (err) {
    console.error("List users error:", err);
    res.status(500).json({ error: "Failed to list users" });
  }
});

// POST /api/auth/users
router.post("/users", authRequired, adminOnly, async (req, res) => {
  const { username, password, role, member_id, email } = req.body || {};
  if (!username || !password || !role) {
    return res.status(400).json({ error: "Username, password, and role are required" });
  }
  if (!["admin", "employee"].includes(role)) {
    return res.status(400).json({ error: "Role must be 'admin' or 'employee'" });
  }
  if (role === "employee" && !member_id) {
    return res.status(400).json({ error: "Employee accounts must be linked to a team member" });
  }

  const hash = bcrypt.hashSync(password, 10);
  try {
    const { rows } = await db.query(
      "INSERT INTO users (username, password_hash, role, member_id, email) VALUES ($1, $2, $3, $4, $5) RETURNING id",
      [username.trim(), hash, role, member_id || null, email?.trim() || null]
    );

    await logAudit(req.user.id, "create_user", { username, role, member_id });
    res.json({ id: rows[0].id });
  } catch (e) {
    res.status(400).json({ error: "Username already exists or database constraint error" });
  }
});

// PUT /api/auth/users/:id
router.put("/users/:id", authRequired, adminOnly, async (req, res) => {
  const { role, member_id, active, password, email } = req.body || {};
  try {
    const { rows } = await db.query("SELECT * FROM users WHERE id = $1", [req.params.id]);
    const user = rows[0];
    if (!user) return res.status(404).json({ error: "User not found" });

    const newRole = role || user.role;
    const newMember = member_id !== undefined ? member_id : user.member_id;
    const newActive = active !== undefined ? (active ? 1 : 0) : user.active;
    const newEmail = email !== undefined ? email : user.email;

    await db.query(
      "UPDATE users SET role = $1, member_id = $2, active = $3, email = $4 WHERE id = $5",
      [newRole, newMember || null, newActive, newEmail || null, user.id]
    );

    if (password) {
      const hash = bcrypt.hashSync(password, 10);
      await db.query(
        "UPDATE users SET password_hash = $1, must_change_password = 1 WHERE id = $2",
        [hash, user.id]
      );
    }

    await logAudit(req.user.id, "update_user", { id: user.id });
    res.json({ ok: true });
  } catch (err) {
    console.error("Update user error:", err);
    res.status(500).json({ error: "Failed to update user account" });
  }
});

// DELETE /api/auth/users/:id (Soft-deactivate)
router.delete("/users/:id", authRequired, adminOnly, async (req, res) => {
  try {
    await db.query("UPDATE users SET active = 0 WHERE id = $1", [req.params.id]);
    await logAudit(req.user.id, "deactivate_user", { id: req.params.id });
    res.json({ ok: true });
  } catch (err) {
    console.error("Deactivate user error:", err);
    res.status(500).json({ error: "Failed to deactivate user" });
  }
});

module.exports = router;
