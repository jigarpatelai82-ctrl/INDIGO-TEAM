// api/index.js — Vercel Serverless Function Handler for Express API
const app = require("../backend/app");

// Export Express app directly as the Vercel Serverless handler
module.exports = app;
