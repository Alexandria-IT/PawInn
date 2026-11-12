import bcrypt from "bcryptjs";
import { accountTransaction, recordAccountAudit, userFields } from "./db.js";
import { clean, credentials, fail, fields, parseId, send, userDto } from "./http.js";

const managedRoles = ["CUSTOMER", "STAFF"];
const statuses = ["ACTIVE", "SUSPENDED"];
const pageSize = 50;

// Add the status to accounts shown in the admin portal.
const adminUser = (user) => ({ ...userDto(user), status: user.account_status });

// Check a role or status filter, including omitted values.
function choice(value, options, label) {
  if (value === undefined) return null;
  if (!options.includes(value)) fail(400, `Choose a valid ${label}.`);
  return value;
}

// Parse a required ID for a target or cursor.
function requiredId(value) {
  const parsed = parseId(value);
  if (!parsed) fail(400, "Invalid account or page ID.");
  return parsed;
}

// Return one page with a cursor only when another page is available.
function page(rows, idField, mapRow) {
  const current = rows.slice(0, pageSize);
  return {
    items: current.map(mapRow),
    nextBefore: rows.length > pageSize ? String(current.at(-1)[idField]) : null,
  };
}

// Expose audit history with the actor and target identities.
function auditEntry(row) {
  return {
    id: String(row.audit_id),
    actor: { id: String(row.actor_id), name: row.actor_name, email: row.actor_email },
    target: { id: String(row.target_id), name: row.target_name, email: row.target_email },
    action: row.action,
    details: row.details,
    createdAt: row.created_at,
  };
}

// Register the admin-only account management routes.
export function registerAdminRoutes(router, pool, authenticate, { allowFixtures, fixtureBlocked }) {
  router.use("/admin", authenticate, /* Enforce the admin role. */ (req, _res, next) => {
    if (req.accountUser.role !== "ADMIN") fail(403, "Administrator access is required.");
    next();
  });

  router.get("/admin/users", /* Search accounts and filter by current role and status. */ async (req, res) => {
    const query = clean(req.query.q, "Search", 254);
    const role = choice(req.query.role, [...managedRoles, "ADMIN"], "role");
    const status = choice(req.query.status, statuses, "status");
    const before = req.query.before === undefined ? null : requiredId(req.query.before);
    const { rows } = await pool.query(
      `SELECT ${userFields} FROM users
        WHERE ($1::text IS NULL OR strpos(lower(full_name), lower($1)) > 0 OR strpos(lower(email), lower($1)) > 0)
          AND ($2::text IS NULL OR role = $2)
          AND ($3::text IS NULL OR account_status = $3)
          AND ($4::integer IS NULL OR user_id < $4)
          AND ($5::boolean OR lower(email) NOT LIKE '%@pawinn.demo')
        ORDER BY user_id DESC LIMIT $6`,
      [query, role, status, before, allowFixtures, pageSize + 1],
    );
    const { items, nextBefore } = page(rows, "user_id", adminUser);
    send(res, { users: items, nextBefore });
  });

  router.post("/admin/users", /* Create a staff account and record who created it. */ async (req, res) => {
    const input = fields(req.body, ["name", "email", "password", "phone"]);
    const { email, password } = credentials(input, 12);
    if (fixtureBlocked(email)) fail(400, "Use a different email address.");
    const name = clean(input.name, "Full name", 80, 2);
    const phone = clean(input.phone, "Phone", 30);
    const hash = await bcrypt.hash(password, 10);
    const actor = req.accountUser.user_id;
    try {
      const staff = await accountTransaction(pool, async (db) => {
        const { rows: [user] } = await db.query(
          `INSERT INTO users (full_name,email,password_hash,phone,role)
            VALUES ($1,$2,$3,$4,'STAFF') RETURNING ${userFields}`,
          [name, email, hash, phone],
        );
        await recordAccountAudit(db, actor, user.user_id, "STAFF_CREATED", {
          role: user.role, status: user.account_status,
        });
        return user;
      });
      send(res, adminUser(staff), 201);
    } catch (error) {
      if (error.code === "23505") fail(409, "This email already has an account.");
      throw error;
    }
  });

  router.patch("/admin/users/:userId", /* Apply role or status changes without deleting account history. */ async (req, res) => {
    const target = requiredId(req.params.userId);
    const input = fields(req.body, ["role", "status"]);
    const role = choice(input.role, managedRoles, "role");
    const status = choice(input.status, statuses, "status");
    if (!role && !status) fail(400, "Choose a role or status to update.");
    const actor = req.accountUser.user_id;
    const user = await accountTransaction(pool, async (db) => {
      const { rows: [current] } = await db.query(
        `SELECT ${userFields} FROM users WHERE user_id=$1 FOR UPDATE`,
        [target],
      );
      if (!current || fixtureBlocked(current.email)) fail(404, "Account not found.");
      if (!managedRoles.includes(current.role)) fail(403, "Only customer and staff accounts can be managed here.");
      const nextRole = role ?? current.role;
      const nextStatus = status ?? current.account_status;
      const roleChanged = nextRole !== current.role;
      const statusChanged = nextStatus !== current.account_status;
      if (!roleChanged && !statusChanged) return current;
      const { rows: [updated] } = await db.query(
        `UPDATE users SET role=$2, account_status=$3, session_version=session_version+1
          WHERE user_id=$1 RETURNING ${userFields}`,
        [target, nextRole, nextStatus],
      );
      if (roleChanged)
        await recordAccountAudit(db, actor, target,
          nextRole === "STAFF" ? "STAFF_GRANTED" : "STAFF_REVOKED",
          { from: current.role, to: nextRole },
        );
      if (statusChanged)
        await recordAccountAudit(db, actor, target,
          nextStatus === "ACTIVE" ? "ACCOUNT_REACTIVATED" : "ACCOUNT_SUSPENDED",
          { from: current.account_status, to: nextStatus },
        );
      return updated;
    });
    send(res, adminUser(user));
  });

  router.get("/admin/audit", /* List account changes, optionally for a specific target. */ async (req, res) => {
    const target = req.query.userId === undefined ? null : requiredId(req.query.userId);
    const before = req.query.before === undefined ? null : requiredId(req.query.before);
    const { rows } = await pool.query(
      `SELECT log.*, actor.full_name AS actor_name, actor.email AS actor_email,
              target.full_name AS target_name, target.email AS target_email
         FROM account_audit log
         JOIN users actor ON actor.user_id=log.actor_id
         JOIN users target ON target.user_id=log.target_id
        WHERE ($1::integer IS NULL OR log.target_id=$1)
          AND ($2::integer IS NULL OR log.audit_id < $2)
        ORDER BY log.audit_id DESC LIMIT $3`,
      [target, before, pageSize + 1],
    );
    const { items, nextBefore } = page(rows, "audit_id", auditEntry);
    send(res, { entries: items, nextBefore });
  });
}
