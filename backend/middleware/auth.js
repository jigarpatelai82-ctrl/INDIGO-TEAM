// backend/middleware/auth.js — JWT Verification & RBAC Authorization
const jwt = require("jsonwebtoken");

function getSecret() {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    if (process.env.NODE_ENV === "production") {
      throw new Error("FATAL: JWT_SECRET environment variable is missing in production.");
    }
    // Non-production fallback with explicit warning
    return "dev-insecure-jwt-secret-key-change-in-prod";
  }
  return secret;
}

function authRequired(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7).trim() : null;

  if (!token) {
    return res.status(401).json({ error: "Not authenticated" });
  }

  try {
    const secret = getSecret();
    req.user = jwt.verify(token, secret);
    next();
  } catch (err) {
    if (err.name === "TokenExpiredError") {
      return res.status(401).json({ error: "Session expired. Please log in again." });
    }
    return res.status(401).json({ error: "Invalid session or signature" });
  }
}

function adminOnly(req, res, next) {
  if (!req.user || req.user.role !== "admin") {
    return res.status(403).json({ error: "Admin access required" });
  }
  next();
}

module.exports = {
  authRequired,
  adminOnly,
  getSecret,
  get SECRET() {
    return getSecret();
  },
};
