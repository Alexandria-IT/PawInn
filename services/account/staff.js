import { readFileSync } from "node:fs";
import bcrypt from "bcryptjs";
import { createPool } from "./db.js";

const [emailArg, nameArg] = process.argv.slice(2);
const email = emailArg?.trim().toLowerCase();
const name = nameArg?.trim();
// Read the password through stdin so it stays out of command arguments.
const password = readFileSync(0, "utf8").replace(/\r?\n$/, "");
if (
  !email ||
  email.length > 254 ||
  !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ||
  email.endsWith("@pawinn.demo") ||
  !name ||
  name.length > 80 ||
  password.length < 12 ||
  Buffer.byteLength(password) > 72
) {
  console.error(
    "Supply a new staff email, a name, and a 12-character minimum password (up to 72 bytes) on stdin.",
  );
  process.exitCode = 1;
} else {
  const pool = createPool();
  try {
    await pool.query(
      "INSERT INTO users(full_name,email,password_hash,role) VALUES ($1,$2,$3,'STAFF')",
      [name, email, await bcrypt.hash(password, 10)],
    );
    console.log("Staff account created.");
  } catch (error) {
    console.error(
      error.code === "23505"
        ? "That email already has an account."
        : "Staff account could not be created.",
    );
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}
