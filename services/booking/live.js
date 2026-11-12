import { fail } from "../shared/runtime.js";

const channel = "pawinn_booking_change";
const subscribers = new Set();
const showFixtures = /^(1|true)$/i.test(process.env.PAWINN_SEED_DEMO || "");
let connection = null;
let connecting = null;
let stopping = false;

// Send one event only to staff who can see the booking and its owner.
function publish({ channel: source, payload }) {
  if (source !== channel) return;
  let change;
  try {
    change = JSON.parse(payload);
  } catch {
    return;
  }
  if (!change || typeof change.bookingId !== "string") return;
  const { bookingId, ownerId, fixture, area } = change;
  const message = `data: ${JSON.stringify({ bookingId, area })}\n\n`;
  for (const { user, response } of subscribers) {
    if (
      (user.role === "STAFF" && (showFixtures || !fixture)) ||
      user.user_id === ownerId
    ) {
      if (!response.write(message)) response.end();
    }
  }
}

// Release a broken listener and let connected browsers reconnect.
function disconnect(client) {
  if (connection !== client) return;
  connection = null;
  client.release(true);
  for (const { response } of subscribers) response.end();
}

// Share one PostgreSQL listener across all the open browser streams.
async function startListener(pool) {
  const client = await pool.connect();
  if (stopping) {
    client.release(true);
    return;
  }
  connection = client;
  client.on("notification", publish);
  client.on("error", () => disconnect(client));
  try {
    await client.query("LISTEN pawinn_booking_change");
  } catch (error) {
    disconnect(client);
    throw error;
  }
}

// Close streams before the service stops accepting requests.
export function stopBookingEvents() {
  stopping = true;
  if (connection) disconnect(connection);
}

// Send authenticated change notifications without including booking records.
export function registerBookingEvents(router, pool, auth) {
  router.get("/bookings/live", auth(), async (req, res) => {
    if (!connection || connecting) {
      connecting ??= startListener(pool).finally(() => { connecting = null; });
      try {
        await connecting;
      } catch {
        fail(503, "Live booking updates are temporarily unavailable.");
      }
    }
    if (res.destroyed) return;
    if (!connection || stopping) fail(503, "Live booking updates are temporarily unavailable.");

    res.set({
      "Content-Type": "text/event-stream",
      "X-Accel-Buffering": "no",
    });
    const subscriber = { user: req.user, response: res };
    subscribers.add(subscriber);
    // Reconnect periodically so the existing role and session checks run again.
    const heartbeat = setInterval(() => {
      if (!res.write(": keepalive\n\n")) res.end();
    }, 10_000);
    const expiry = setTimeout(() => res.end(), 55_000);
    res.once("close", () => {
      clearInterval(heartbeat);
      clearTimeout(expiry);
      subscribers.delete(subscriber);
    });
    res.write('data: {"area":"sync"}\n\n');
  });
}
