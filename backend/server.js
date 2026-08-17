// backend/server.js — Local / Standalone Development Server Entry Point
require("dotenv").config();
const app = require("./app");
const db = require("./db");

const PORT = parseInt(process.env.PORT || "3000", 10);

async function start() {
  try {
    if (process.env.DATABASE_URL) {
      await db.initSchema();
      console.log(" PostgreSQL database connected and schema verified.");
    } else {
      console.warn("⚠️ DATABASE_URL not set — database operations will fail until configured.");
    }

    app.listen(PORT, "0.0.0.0", () => {
      console.log(`INDIGO TEAM development server running at http://localhost:${PORT}`);
    });
  } catch (err) {
    console.error("Failed to start local development server:", err);
    process.exit(1);
  }
}

if (require.main === module) {
  start();
}

module.exports = { start };
