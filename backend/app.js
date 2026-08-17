// backend/app.js — Reusable Express Application for Vercel Serverless & Local Runtime
require("dotenv").config();
const express = require("express");
const cors = require("cors");
const path = require("path");

const app = express();

// Security and standard middleware
app.use(cors());
app.use(express.json());

// Health check endpoint
app.get("/api/health", (req, res) => {
  res.json({
    status: "ok",
    app: "INDIGO TEAM",
    time: new Date().toISOString(),
    env: process.env.NODE_ENV || "development",
  });
});

// Register all modular API routes
app.use("/api/auth", require("./routes/auth"));
app.use("/api/members", require("./routes/members"));
app.use("/api/projects", require("./routes/projects"));
app.use("/api/clients", require("./routes/clients"));
app.use("/api/search", require("./routes/search"));
app.use("/api/leaves", require("./routes/leaves"));
app.use("/api/timesheets", require("./routes/timesheets"));
app.use("/api/tasks", require("./routes/tasks"));
app.use("/api/summary", require("./routes/summary"));
app.use("/api/notifications", require("./routes/notifications"));

// Serve static frontend assets for monolithic / local runtime
const frontendPath = path.join(__dirname, "..", "frontend");
app.use(express.static(frontendPath));

app.get("*", (req, res, next) => {
  if (req.path.startsWith("/api/")) {
    return res.status(404).json({ error: "API endpoint not found" });
  }
  res.sendFile(path.join(frontendPath, "index.html"), (err) => {
    if (err) next();
  });
});

// Centralized error handling middleware
app.use((err, req, res, next) => {
  console.error("Unhandled server error:", err);
  const message =
    process.env.NODE_ENV === "production"
      ? "Internal server error"
      : err.message || "Server error";
  res.status(err.status || 500).json({ error: message });
});

module.exports = app;
