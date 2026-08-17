// backend/seed.js — Idempotent Admin Bootstrap Script
require("dotenv").config();
const bcrypt = require("bcryptjs");
const db = require("./db");

const username = process.env.SEED_ADMIN_USER || "admin";
const password = process.env.SEED_ADMIN_PASS || "admin123";

async function seed() {
  console.log("==> Initializing schema & verifying initial admin account...");
  await db.initSchema();

  const { rows } = await db.query("SELECT id, username, role FROM users WHERE username = $1", [
    username,
  ]);

  if (rows[0]) {
    console.log(`User "${username}" already exists (ID: ${rows[0].id}, Role: ${rows[0].role}) — skipping creation.`);
  } else {
    const hash = bcrypt.hashSync(password, 10);
    const result = await db.query(
      "INSERT INTO users (username, password_hash, role, must_change_password) VALUES ($1, $2, 'admin', 1) RETURNING id",
      [username, hash]
    );
    console.log(` Admin account successfully created.`);
    console.log(`   ID: ${result.rows[0].id}`);
    console.log(`   Username: ${username}`);
    console.log(`   Password: ${password}`);
    console.log(`   IMPORTANT: Log in and change this initial password immediately.`);
  }
}

if (require.main === module) {
  seed()
    .then(() => db.pool.end())
    .catch((err) => {
      console.error("Seed error:", err);
      process.exit(1);
    });
}

module.exports = { seed };
