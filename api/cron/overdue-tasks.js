// api/cron/overdue-tasks.js — Vercel Cron Endpoint for Automated Daily Overdue Alerts
require("dotenv").config();
const db = require("../../backend/db");
const mailer = require("../../backend/mailer");
const { overdueAndDueToday } = require("../../backend/routes/notifications");

module.exports = async (req, res) => {
  // 1. Verify Vercel Cron Authorization (Fail-closed: requires CRON_SECRET)
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    console.error("FATAL: CRON_SECRET is not set in environment. Refusing to execute cron job.");
    return res.status(500).json({ error: "Server Configuration Error: CRON_SECRET is not configured." });
  }

  const authHeader = req.headers.authorization || "";
  const expectedAuth = `Bearer ${cronSecret}`;

  if (authHeader !== expectedAuth) {
    console.warn("Unauthorized invocation attempt on /api/cron/overdue-tasks");
    return res.status(401).json({ error: "Unauthorized: Invalid or missing CRON_SECRET Bearer token." });
  }

  // 2. Query overdue tasks
  try {
    const allOverdue = (await overdueAndDueToday(null)).filter((t) => t.overdue);

    if (!allOverdue.length) {
      return res.json({
        ok: true,
        message: "No overdue tasks found today.",
        overdue_tasks: 0,
        emails_sent: 0,
        timestamp: new Date().toISOString(),
      });
    }

    // 3. Group by assigned team member
    const byMember = {};
    for (const t of allOverdue) {
      if (!byMember[t.assigned_to]) byMember[t.assigned_to] = [];
      byMember[t.assigned_to].push(t);
    }

    let sentCount = 0;

    // 4. Send email if SMTP is configured
    if (mailer.isConfigured()) {
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
                `- ${t.title} (Due date: ${t.due_date}, Priority: ${t.priority}, Importance: ${t.importance})`
            )
            .join("\n") +
          `\n\nPlease log in and update your timesheet or task progress.`;

        const result = await mailer.sendMail(
          user.email,
          `${tasks.length} overdue task(s) — action needed`,
          text
        );
        if (result.sent) sentCount++;
      }
    }

    return res.json({
      ok: true,
      overdue_tasks: allOverdue.length,
      affected_members: Object.keys(byMember).length,
      emails_sent: sentCount,
      smtp_active: mailer.isConfigured(),
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    console.error("Cron overdue-tasks execution error:", err);
    return res.status(500).json({ error: "Failed to execute overdue task job", message: err.message });
  }
};
