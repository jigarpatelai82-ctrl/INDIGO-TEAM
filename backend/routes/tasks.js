// backend/routes/tasks.js — Task Assignment, Acceptance & Performance Reports
const express = require("express");
const db = require("../db");
const { authRequired, adminOnly } = require("../middleware/auth");
const router = express.Router();

function enrichTask(t) {
  const efficiency =
    t.estimated_hours > 0 && t.actual_hours > 0
      ? (t.estimated_hours / t.actual_hours) * 100
      : null;
  return { ...t, efficiency_pct: efficiency };
}

// GET /api/tasks — list tasks with query filters & auto viewed_at tracking
router.get("/", authRequired, async (req, res) => {
  let { member_id, status, project_id } = req.query || {};
  if (req.user.role !== "admin") {
    member_id = req.user.member_id;
  }

  let sql = `
    SELECT t.*, m.name as member_name, p.abbr as project_abbr, p.project_no as project_no
    FROM tasks t
    JOIN members m ON m.id = t.assigned_to
    LEFT JOIN projects p ON p.id = t.project_id
    WHERE 1=1
  `;
  const params = [];

  if (member_id) {
    params.push(member_id);
    sql += ` AND t.assigned_to = $${params.length}`;
  }
  if (status) {
    params.push(status);
    sql += ` AND t.status = $${params.length}`;
  }
  if (project_id) {
    params.push(project_id);
    sql += ` AND t.project_id = $${params.length}`;
  }

  sql += `
    ORDER BY t.priority ASC,
    CASE t.importance WHEN 'High' THEN 1 WHEN 'Medium' THEN 2 ELSE 3 END,
    t.due_date IS NULL, t.due_date ASC
  `;

  try {
    const { rows } = await db.query(sql, params);

    // Auto-mark as viewed the first time the assigned employee inspects their own task list
    if (req.user.role !== "admin" && req.user.member_id) {
      const unviewed = rows.filter(
        (t) => !t.viewed_at && String(t.assigned_to) === String(req.user.member_id)
      );
      for (const t of unviewed) {
        await db.query("UPDATE tasks SET viewed_at = NOW() WHERE id = $1", [t.id]);
        t.viewed_at = new Date().toISOString();
      }
    }

    res.json(rows.map(enrichTask));
  } catch (err) {
    console.error("Fetch tasks error:", err);
    res.status(500).json({ error: "Failed to fetch tasks" });
  }
});

// POST /api/tasks — admin only
router.post("/", authRequired, adminOnly, async (req, res) => {
  const {
    title,
    description,
    assigned_to,
    project_id,
    priority,
    importance,
    estimated_hours,
    due_date,
  } = req.body || {};

  if (!title || !assigned_to) {
    return res.status(400).json({ error: "Title and assigned_to member are required" });
  }

  try {
    const { rows } = await db.query(
      `INSERT INTO tasks
       (title, description, assigned_to, assigned_by, project_id, priority, importance, estimated_hours, due_date)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id`,
      [
        title.trim(),
        description || "",
        assigned_to,
        req.user.id,
        project_id || null,
        priority && [1, 2, 3].includes(+priority) ? +priority : 2,
        importance && ["High", "Medium", "Low"].includes(importance) ? importance : "Medium",
        parseFloat(estimated_hours) || 0,
        due_date || null,
      ]
    );

    res.json({ id: rows[0].id });
  } catch (err) {
    console.error("Create task error:", err);
    res.status(500).json({ error: "Failed to create task" });
  }
});

// PUT /api/tasks/:id — admin edits full task; employee updates status
router.put("/:id", authRequired, async (req, res) => {
  try {
    const { rows } = await db.query("SELECT * FROM tasks WHERE id = $1", [req.params.id]);
    const t = rows[0];
    if (!t) return res.status(404).json({ error: "Task not found" });

    const isOwner = String(req.user.member_id) === String(t.assigned_to);
    if (req.user.role !== "admin" && !isOwner) {
      return res.status(403).json({ error: "Unauthorized to modify this task" });
    }

    if (req.user.role === "admin") {
      const {
        title,
        description,
        project_id,
        priority,
        importance,
        estimated_hours,
        due_date,
        status,
        assigned_to,
      } = req.body || {};

      const newStatus = status ?? t.status;
      await db.query(
        `UPDATE tasks
         SET title = $1, description = $2, project_id = $3, priority = $4, importance = $5,
             estimated_hours = $6, due_date = $7, status = $8, assigned_to = $9,
             completed_at = CASE
               WHEN $8 = 'Completed' AND status != 'Completed' THEN NOW()
               WHEN $8 != 'Completed' THEN NULL
               ELSE completed_at
             END
         WHERE id = $10`,
        [
          title !== undefined ? title.trim() : t.title,
          description !== undefined ? description : t.description,
          project_id !== undefined ? project_id : t.project_id,
          priority !== undefined ? +priority : t.priority,
          importance !== undefined ? importance : t.importance,
          estimated_hours !== undefined ? parseFloat(estimated_hours) : t.estimated_hours,
          due_date !== undefined ? due_date : t.due_date,
          newStatus,
          assigned_to !== undefined ? assigned_to : t.assigned_to,
          t.id,
        ]
      );
    } else {
      const { status } = req.body || {};
      if (!status) return res.status(400).json({ error: "Status is required" });

      await db.query(
        `UPDATE tasks
         SET status = $1,
             completed_at = CASE WHEN $1 = 'Completed' THEN NOW() ELSE NULL END
         WHERE id = $2`,
        [status, t.id]
      );
    }

    res.json({ ok: true });
  } catch (err) {
    console.error("Update task error:", err);
    res.status(500).json({ error: "Failed to update task" });
  }
});

// DELETE /api/tasks/:id — admin only
router.delete("/:id", authRequired, adminOnly, async (req, res) => {
  try {
    await db.query("DELETE FROM tasks WHERE id = $1", [req.params.id]);
    res.json({ ok: true });
  } catch (err) {
    console.error("Delete task error:", err);
    res.status(500).json({ error: "Failed to delete task" });
  }
});

// POST /api/tasks/:id/accept — assigned employee acknowledges task
router.post("/:id/accept", authRequired, async (req, res) => {
  try {
    const { rows } = await db.query("SELECT * FROM tasks WHERE id = $1", [req.params.id]);
    const t = rows[0];
    if (!t) return res.status(404).json({ error: "Task not found" });

    if (req.user.role === "admin" || String(req.user.member_id) !== String(t.assigned_to)) {
      return res.status(403).json({ error: "Only the assigned employee can accept this task" });
    }

    await db.query(
      `UPDATE tasks
       SET accepted_at = NOW(),
           viewed_at = COALESCE(viewed_at, NOW()),
           admin_seen_acceptance = 0
       WHERE id = $1`,
      [t.id]
    );

    res.json({ ok: true });
  } catch (err) {
    console.error("Accept task error:", err);
    res.status(500).json({ error: "Failed to accept task" });
  }
});

// POST /api/tasks/:id/ack-acceptance — admin dismisses acceptance alert
router.post("/:id/ack-acceptance", authRequired, adminOnly, async (req, res) => {
  try {
    await db.query("UPDATE tasks SET admin_seen_acceptance = 1 WHERE id = $1", [req.params.id]);
    res.json({ ok: true });
  } catch (err) {
    console.error("Acknowledge acceptance error:", err);
    res.status(500).json({ error: "Failed to acknowledge task acceptance" });
  }
});

// GET /api/tasks/reports/performance — employee efficiency & late task metrics (admin only)
router.get("/reports/performance", authRequired, adminOnly, async (req, res) => {
  try {
    const { rows } = await db.query(`
      SELECT m.id as member_id, m.name,
        COUNT(t.id) as total_tasks,
        SUM(CASE WHEN t.status = 'Completed' THEN 1 ELSE 0 END) as completed_tasks,
        SUM(CASE WHEN t.due_date IS NOT NULL AND t.completed_at IS NOT NULL AND t.completed_at::date > t.due_date::date THEN 1 ELSE 0 END) as late_tasks,
        COALESCE(SUM(CASE WHEN t.status = 'Completed' THEN t.estimated_hours ELSE 0 END), 0) as total_estimated,
        COALESCE(SUM(CASE WHEN t.status = 'Completed' THEN t.actual_hours ELSE 0 END), 0) as total_actual
      FROM members m
      LEFT JOIN tasks t ON t.assigned_to = m.id
      WHERE m.active = 1
      GROUP BY m.id, m.name, m.order_index
      ORDER BY m.order_index
    `);

    const withEff = rows.map((r) => {
      const totEst = parseFloat(r.total_estimated || "0");
      const totAct = parseFloat(r.total_actual || "0");
      return {
        ...r,
        total_tasks: parseInt(r.total_tasks || "0", 10),
        completed_tasks: parseInt(r.completed_tasks || "0", 10),
        late_tasks: parseInt(r.late_tasks || "0", 10),
        total_estimated: totEst,
        total_actual: totAct,
        efficiency_pct: totAct > 0 ? (totEst / totAct) * 100 : null,
      };
    });

    res.json(withEff);
  } catch (err) {
    console.error("Performance report error:", err);
    res.status(500).json({ error: "Failed to generate performance report" });
  }
});

module.exports = router;
