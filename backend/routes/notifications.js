// backend/routes/notifications.js — In-App Notifications & Overdue Alerts
const express = require("express");
const db = require("../db");
const { authRequired, adminOnly } = require("../middleware/auth");
const mailer = require("../mailer");
const router = express.Router();

function getTodayDateStr() {
  try {
    return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date());
  } catch (e) {
    return new Date().toISOString().slice(0, 10);
  }
}

async function overdueAndDueToday(memberId) {
  const today = getTodayDateStr();
  let sql = `
    SELECT t.*, m.name as member_name, p.abbr as project_abbr, p.project_no as project_no
    FROM tasks t
    JOIN members m ON m.id = t.assigned_to
    LEFT JOIN projects p ON p.id = t.project_id
    WHERE t.status != 'Completed' AND t.due_date IS NOT NULL AND t.due_date <= $1
  `;
  const params = [today];
  if (memberId) {
    params.push(memberId);
    sql += ` AND t.assigned_to = $${params.length}`;
  }
  sql += " ORDER BY t.due_date ASC";

  const { rows } = await db.query(sql, params);
  return rows.map((t) => ({ ...t, overdue: t.due_date < today }));
}

// GET /api/notifications — in-app notifications
router.get("/", authRequired, async (req, res) => {
  try {
    const memberId = req.user.role === "admin" ? null : req.user.member_id;
    const tasks = await overdueAndDueToday(memberId);
    res.json(tasks);
  } catch (err) {
    console.error("Fetch notifications error:", err);
    res.status(500).json({ error: "Failed to fetch notifications" });
  }
});

// GET /api/notifications/acceptance — task acknowledgement queue
router.get("/acceptance", authRequired, async (req, res) => {
  try {
    if (req.user.role === "admin") {
      const recentlyAccepted = (
        await db.query(`
          SELECT t.*, m.name as member_name, p.abbr as project_abbr
          FROM tasks t
          JOIN members m ON m.id = t.assigned_to
          LEFT JOIN projects p ON p.id = t.project_id
          WHERE t.accepted_at IS NOT NULL AND t.admin_seen_acceptance = 0
          ORDER BY t.accepted_at DESC
        `)
      ).rows;

      const awaitingAcceptance = (
        await db.query(`
          SELECT t.*, m.name as member_name, p.abbr as project_abbr
          FROM tasks t
          JOIN members m ON m.id = t.assigned_to
          LEFT JOIN projects p ON p.id = t.project_id
          WHERE t.accepted_at IS NULL AND t.status != 'Completed'
            AND t.created_at < NOW() - INTERVAL '24 hours'
          ORDER BY t.created_at ASC
        `)
      ).rows;

      res.json({ recentlyAccepted, awaitingAcceptance });
    } else {
      const needsAcceptance = (
        await db.query(
          `
          SELECT t.*, p.abbr as project_abbr
          FROM tasks t
          LEFT JOIN projects p ON p.id = t.project_id
          WHERE t.assigned_to = $1 AND t.accepted_at IS NULL AND t.status != 'Completed'
          ORDER BY t.priority ASC, t.created_at ASC
        `,
          [req.user.member_id]
        )
      ).rows;

      res.json({ needsAcceptance });
    }
  } catch (err) {
    console.error("Fetch acceptance notifications error:", err);
    res.status(500).json({ error: "Failed to fetch task acceptance notifications" });
  }
});

// POST /api/notifications/send-overdue-emails — admin manual trigger
router.post("/send-overdue-emails", authRequired, adminOnly, async (req, res) => {
  if (!mailer.isConfigured()) {
    return res.json({
      sent: 0,
      note: "SMTP not configured — set SMTP_HOST, SMTP_USER, SMTP_PASS env vars to enable email alerts. In-app notifications remain active.",
    });
  }

  try {
    const overdue = (await overdueAndDueToday(null)).filter((t) => t.overdue);
    const byMember = {};
    overdue.forEach((t) => {
      (byMember[t.assigned_to] = byMember[t.assigned_to] || []).push(t);
    });

    let sentCount = 0;
    for (const memberId of Object.keys(byMember)) {
      const userRes = await db.query(
        "SELECT email FROM users WHERE member_id = $1 AND active = 1",
        [memberId]
      );
      const user = userRes.rows[0];
      if (!user?.email) continue;

      const tasks = byMember[memberId];
      const text =
        `You have ${tasks.length} overdue task(s) in INDIGO TEAM:\n\n` +
        tasks
          .map(
            (t) =>
              `- ${t.title} (Due: ${t.due_date}, Priority: ${t.priority}, Importance: ${t.importance})`
          )
          .join("\n") +
        `\n\nPlease review and update your timesheet or task progress.`;

      const result = await mailer.sendMail(
        user.email,
        `${tasks.length} overdue task(s) — action needed`,
        text
      );
      if (result.sent) sentCount++;
    }

    res.json({
      sent: sentCount,
      total_overdue_people: Object.keys(byMember).length,
    });
  } catch (err) {
    console.error("Send overdue emails error:", err);
    res.status(500).json({ error: "Failed to dispatch overdue emails" });
  }
});

module.exports = router;
module.exports.overdueAndDueToday = overdueAndDueToday;
