// backend/mailer.js — SMTP Email Dispatcher with Safe Fallback
let nodemailer;
try {
  nodemailer = require("nodemailer");
} catch (e) {
  /* optional dependency */
}

function isConfigured() {
  return !!(
    process.env.SMTP_HOST &&
    process.env.SMTP_USER &&
    process.env.SMTP_PASS
  );
}

function getTransporter() {
  if (!isConfigured() || !nodemailer) return null;
  return nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: parseInt(process.env.SMTP_PORT || "587", 10),
    secure: process.env.SMTP_SECURE === "true" || process.env.SMTP_PORT === "465",
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
  });
}

async function sendMail(to, subject, text, html = null) {
  if (!isConfigured() || !nodemailer || !to) {
    return { sent: false, reason: "SMTP not configured or missing recipient" };
  }

  try {
    const transporter = getTransporter();
    if (!transporter) return { sent: false, reason: "Transporter initialization failed" };

    const from = process.env.SMTP_FROM || process.env.SMTP_USER;
    const mailOptions = { from, to, subject, text };
    if (html) mailOptions.html = html;

    const info = await transporter.sendMail(mailOptions);
    return { sent: true, messageId: info.messageId };
  } catch (err) {
    console.error("Email send failed:", err.message);
    return { sent: false, reason: err.message };
  }
}

module.exports = {
  sendMail,
  isConfigured,
  get enabled() {
    return isConfigured();
  },
};
