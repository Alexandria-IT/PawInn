import { readFileSync } from "node:fs";
import bcrypt from "bcryptjs";
import { accountTransaction, createPool, lockAccountSchema, recordAccountAudit } from "./db.js";
import { clean, credentials } from "./http.js";

// Create the first administrator under a database lock, without a default account.
async function bootstrap() {
  const [emailArg, nameArg] = process.argv.slice(2);
  const name = clean(nameArg, "Full name", 80, 2);
  // Read the password from stdin so it stays out of process arguments.
  const supplied = readFileSync(0, "utf8").replace(/\r?\n$/, "");
  const { email, password } = credentials({ email: emailArg, password: supplied }, 12);
  if (email.endsWith("@pawinn.demo")) throw new Error("Use a different email address.");
  const hash = await bcrypt.hash(password, 10);
  const pool = createPool();
  try {
    await accountTransaction(pool, async (db) => {
      await lockAccountSchema(db);
      const { rowCount } = await db.query("SELECT 1 FROM users WHERE role='ADMIN' LIMIT 1");
      if (rowCount) throw new Error("An administrator already exists.");
      const { rows: [admin] } = await db.query(
        "INSERT INTO users (full_name,email,password_hash,role) VALUES ($1,$2,$3,'ADMIN') RETURNING user_id",
        [name, email, hash],
      );
      await recordAccountAudit(db, admin.user_id, admin.user_id, "ADMIN_BOOTSTRAPPED", { source: "CLI" });
    });
    console.log("Administrator account created.");
  } finally {
    await pool.end();
  }
}

try {
  await bootstrap();
} catch (error) {
  console.error(error.code === "23505" ? "That email already has an account." :
    error.code ? "Administrator account could not be created." : error.message);
  process.exitCode = 1;
}
