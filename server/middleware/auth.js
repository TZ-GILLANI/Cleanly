import jwt from "jsonwebtoken";
import { query } from "../db.js";

const SECRET = process.env.JWT_SECRET || "cleanly-dev-secret-change-in-production";
if (process.env.NODE_ENV === "production" && !process.env.JWT_SECRET) {
  throw new Error("JWT_SECRET must be set in production. Generate one: node -e \"console.log(require('crypto').randomBytes(64).toString('hex'))\"");
}

export const signToken = (payload) => jwt.sign(payload, SECRET, { expiresIn: "7d" });

export async function requireAuth(req, res, next) {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) return res.status(401).json({ error: "No token" });
  try {
    req.user = jwt.verify(header.slice(7), SECRET);
  } catch {
    return res.status(401).json({ error: "Invalid or expired token" });
  }
  try {
    // Admin suspension must bite immediately, not when the 7-day token expires.
    const r = await query("SELECT is_active FROM users WHERE id = $1", [req.user.id]);
    if (!r.rows.length || r.rows[0].is_active === false)
      return res.status(403).json({ error: "Account is deactivated" });
    next();
  } catch (err) {
    console.error("auth check error:", err);
    res.status(500).json({ error: "Auth check failed" });
  }
}

export function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: "Not authenticated" });
    if (!roles.includes(req.user.role)) return res.status(403).json({ error: "Forbidden" });
    next();
  };
}
