import pg from "pg";
import { readFile } from "node:fs/promises";
import { setTimeout as delay } from "node:timers/promises";

const accountSchemaLockId = 42002;
const startupConnectionErrors = new Set([
  "ECONNREFUSED", "ECONNRESET", "ETIMEDOUT", "EAI_AGAIN", "ENOTFOUND",
  "08001", "08006", "57P01", "57P02", "57P03",
]);

// Connect Account to the configured PostgreSQL database.
export function createPool(env = process.env) {
  if (!env.POSTGRES_PASSWORD)
    throw new Error("Set POSTGRES_PASSWORD in the root .env.");
  return new pg.Pool({
    host: env.POSTGRES_HOST || "127.0.0.1",
    port: Number(env.POSTGRES_PORT || 5432),
    user: env.POSTGRES_USER || "pawinn",
    password: env.POSTGRES_PASSWORD,
    database: env.POSTGRES_DB || "pawinn",
    max: 10,
    connectionTimeoutMillis: 3000,
    statement_timeout: 5000,
  });
}

// Apply the schema upgrade atomically.
async function accountTransaction(pool, operation) {
  const db = await pool.connect();
  try {
    await db.query("BEGIN");
    const result = await operation(db);
    await db.query("COMMIT");
    return result;
  } catch (error) {
    await db.query("ROLLBACK");
    throw error;
  } finally {
    db.release();
  }
}

// Serialize schema upgrades across Account instances.
function lockAccountSchema(db) {
  return db.query("SELECT pg_advisory_xact_lock($1)", [accountSchemaLockId]);
}

// Prepare both new and existing databases before serving requests.
export async function prepareAccount(pool) {
  const schema = await readFile(new URL("./account-migration.sql", import.meta.url), "utf8");
  for (let attempt = 1; ; attempt++) {
    try {
      await accountTransaction(pool, async (db) => {
        await lockAccountSchema(db);
        await db.query(schema);
      });
      return;
    } catch (error) {
      if (attempt >= 15 || (error.code && !startupConnectionErrors.has(error.code))) throw error;
      await delay(1000);
    }
  }
}

// Match Booking's two-minute hold and Bangkok calendar date.
const activePetBooking = `status = 'CONFIRMED' OR (
  status = 'PENDING'
  AND created_at > statement_timestamp() - interval '2 minutes'
  AND check_in_date >= (statement_timestamp() AT TIME ZONE 'Asia/Bangkok')::date
)`;

// Return the booking state needed to choose a pet management action.
export function listOwnedPets(pool, owner, includeArchived) {
  return pool.query(
    `SELECT ${petFields}, history.state AS booking_state
     FROM pets p
     CROSS JOIN LATERAL (
       SELECT CASE WHEN bool_or(${activePetBooking}) THEN 'ACTIVE'
                   WHEN count(*) > 0 THEN 'HISTORY' ELSE 'NONE' END AS state
       FROM bookings WHERE pet_id=p.pet_id
     ) history
     WHERE owner_id=$1 AND ($2::boolean OR archived_at IS NULL) ORDER BY pet_id`,
    [owner, includeArchived],
  );
}

// Archive or restore an owned pet while serializing against booking changes.
export function setPetArchived(pool, id, owner, archived) {
  return accountTransaction(pool, async (db) => {
    // Take Booking's inventory lock before taking the pet row lock.
    await db.query("SELECT pg_advisory_xact_lock(42001)");
    const { rows: [pet] } = await db.query(
      "SELECT archived_at FROM pets WHERE pet_id=$1 AND owner_id=$2 FOR UPDATE",
      [id, owner],
    );
    if (!pet) return "MISSING";
    if (Boolean(pet.archived_at) === archived) return "OK";
    if (archived) {
      const { rows: [history] } = await db.query(
        `SELECT count(*) > 0 AS has_history, bool_or(${activePetBooking}) AS active
         FROM bookings WHERE pet_id=$1`,
        [id],
      );
      if (history.active) return "ACTIVE";
      if (!history.has_history) return "NO_HISTORY";
    }
    await db.query(
      "UPDATE pets SET archived_at=CASE WHEN $3::boolean THEN now() ELSE NULL END WHERE pet_id=$1 AND owner_id=$2",
      [id, owner, archived],
    );
    return "OK";
  });
}

// Update an owned pet while checking active reservations.
export async function updatePet(pool, id, owner, changes) {
  const db = await pool.connect();
  let committed = false;
  try {
    await db.query("BEGIN");
    // Booking locks the same pet row before reading its species and reserving a room.
    const {
      rows: [current],
    } = await db.query(
      "SELECT " +
        petFields +
        " FROM pets WHERE pet_id=$1 AND owner_id=$2 FOR UPDATE",
      [id, owner],
    );
    if (!current) return { status: 404 };
    if (changes.species && changes.species !== current.species) {
      const {
        rows: [{ active }],
      } = await db.query(
        "SELECT EXISTS (SELECT 1 FROM bookings WHERE pet_id=$1 AND status IN ('PENDING', 'CONFIRMED')) AS active",
        [id],
      );
      if (active) return { status: 409 };
    }
    const {
      rows: [pet],
    } = await db.query(
      `UPDATE pets SET name=$3, species=$4, breed=$5, birth_date=$6, care_notes=$7
       WHERE pet_id=$1 AND owner_id=$2 RETURNING ${petFields}`,
      [
        id,
        owner,
        changes.name ?? current.name,
        changes.species ?? current.species,
        "breed" in changes ? changes.breed : current.breed,
        "birthDate" in changes ? changes.birthDate : current.birth_date,
        "notes" in changes ? changes.notes : current.care_notes,
      ],
    );
    await db.query("COMMIT");
    committed = true;
    return { pet };
  } finally {
    try {
      if (!committed) await db.query("ROLLBACK");
    } finally {
      db.release();
    }
  }
}

export const petFields =
  "pet_id, owner_id, name, species, breed, to_char(birth_date, 'YYYY-MM-DD') AS birth_date, care_notes, archived_at";
export const userFields = "user_id, full_name, email, phone, role, account_status, session_version";
