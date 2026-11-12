import { getToken } from "./account.js";

// Read PawInn's single-line server-sent events, even when split across chunks.
async function readChanges(body, onChange) {
  let buffer = "";
  for await (const chunk of body.pipeThrough(new TextDecoderStream())) {
    buffer += chunk;
    let boundary;
    while ((boundary = buffer.indexOf("\n\n")) !== -1) {
      const event = buffer.slice(0, boundary);
      buffer = buffer.slice(boundary + 2);
      if (event.startsWith("data: ")) onChange(JSON.parse(event.slice(6)));
    }
  }
}

// Keep one authenticated stream open for the active page.
export function startLiveBookingUpdates(onChange, onExpired) {
  let connection;
  let retryTimer;
  let retryDelay = 1000;

  // Connect, then catch up on missed changes whenever the stream reconnects.
  async function connect() {
    const token = getToken();
    if (!token || connection) return;
    const current = new AbortController();
    connection = current;
    let retry = true;
    try {
      const response = await fetch("/api/bookings/live", {
        headers: { Accept: "text/event-stream", Authorization: "Bearer " + token },
        signal: current.signal,
      });
      if (response.status === 401 || response.status === 403) {
        retry = false;
        if (response.status === 401) onExpired();
        return;
      }
      if (!response.ok || !response.headers.get("content-type")?.startsWith("text/event-stream"))
        return;
      retryDelay = 1000;
      await readChanges(response.body, onChange);
    } catch {
      // Reconnect after a network interruption.
    } finally {
      if (connection === current) {
        connection = null;
        if (retry) {
          retryTimer = setTimeout(connect, retryDelay);
          retryDelay = Math.min(retryDelay * 2, 10_000);
        }
      }
    }
  }

  // Release the request when navigating away, and reconnect after history restore.
  window.addEventListener("pagehide", () => {
    clearTimeout(retryTimer);
    connection?.abort();
    connection = null;
  });
  window.addEventListener("pageshow", () => {
    clearTimeout(retryTimer);
    connect();
  });
  connect();
}
