import { readFileSync } from "node:fs";
import bcrypt from "bcryptjs";
import { createPool } from "./db.js";
import { clean, credentials } from "./http.js";

// Create a staff account from the local Account container.
async function createStaff() {
  const [emailArg, nameArg] = process.argv.slice(2);
  const name = clean(nameArg, "Full name", 80, 2);
  // Read the password from stdin to keep it out of process arguments.
  const supplied = readFileSync(0, "utf8").replace(/\r?\n$/, "");
  const { email, password } = credentials({ email: emailArg, password: supplied }, 12);
  if (email.endsWith("@pawinn.demo")) throw new Error("Use a different email address.");
  const hash = await bcrypt.hash(password, 10);
  const pool = createPool();
  try {
    await pool.query(
      "INSERT INTO users (full_name,email,password_hash,role) VALUES ($1,$2,$3,'STAFF')",
      [name, email, hash],
    );
    console.log("Staff account created.");
  } finally {
    await pool.end();
  }
}

try {
  await createStaff();
} catch (error) {
  console.error(error.code === "23505" ? "That email already has an account." :
    error.code ? "Staff account could not be created." : error.message);
  process.exitCode = 1;
}
