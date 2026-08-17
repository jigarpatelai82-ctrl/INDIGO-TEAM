// database/migrate.js — Idempotent migration runner for PostgreSQL / Neon
require("dotenv").config();
const fs = require("fs");
const path = require("path");
const { pool, query } = require("../backend/db");

async function runMigrations() {
  console.log("==> Running database migrations...");

  // Ensure migration tracking table exists
  await query(`
    CREATE TABLE IF NOT EXISTS _migrations (
      id SERIAL PRIMARY KEY,
      name TEXT UNIQUE NOT NULL,
      applied_at TIMESTAMP NOT NULL DEFAULT NOW()
    );
  `);

  const migrationsDir = path.join(__dirname, "migrations");
  const files = fs.readdirSync(migrationsDir).filter(f => f.endsWith(".sql")).sort();

  for (const file of files) {
    const { rows } = await query("SELECT * FROM _migrations WHERE name = $1", [file]);
    if (rows.length > 0) {
      console.log(`  [SKIP] ${file} (already applied)`);
      continue;
    }

    console.log(`  [APPLYING] ${file}...`);
    const sql = fs.readFileSync(path.join(migrationsDir, file), "utf-8");
    
    // Execute migration in a transaction
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(sql);
      await client.query("INSERT INTO _migrations (name) VALUES ($1)", [file]);
      await client.query("COMMIT");
      console.log(`  [DONE] ${file}`);
    } catch (err) {
      await client.query("ROLLBACK");
      console.error(`  [FAILED] ${file}:`, err.message);
      throw err;
    } finally {
      client.release();
    }
  }

  console.log("==> All migrations completed successfully.");
}

if (require.main === module) {
  runMigrations()
    .then(() => pool.end())
    .catch((err) => {
      console.error("Migration error:", err);
      process.exit(1);
    });
}

module.exports = { runMigrations };
