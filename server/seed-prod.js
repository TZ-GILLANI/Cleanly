/* Production seed: creates ONLY the platform admin account.
   Usage (locally, pointed at the production DB):
     DATABASE_URL=postgres://...  ADMIN_EMAIL=you@example.com  ADMIN_PASSWORD=strong-password  node server/seed-prod.js
*/
import "dotenv/config";
import bcrypt from "bcryptjs";
import pool, { query } from "./db.js";

const email = process.env.ADMIN_EMAIL;
const password = process.env.ADMIN_PASSWORD;
if (!email || !password || password.length < 10) {
  console.error("Set ADMIN_EMAIL and ADMIN_PASSWORD (min 10 chars) env vars first.");
  process.exit(1);
}

const hash = await bcrypt.hash(password, 12);
const existing = await query("SELECT id FROM users WHERE email = $1", [email.toLowerCase()]);
if (existing.rows.length) {
  await query("UPDATE users SET password_hash = $1, role = 'admin', is_active = true WHERE email = $2", [hash, email.toLowerCase()]);
  console.log("✔ Admin password updated for", email);
} else {
  await query(
    "INSERT INTO users (email, password_hash, role, full_name) VALUES ($1,$2,'admin','Platform Admin')",
    [email.toLowerCase(), hash]
  );
  console.log("✔ Admin account created:", email);
}
await pool.end();
