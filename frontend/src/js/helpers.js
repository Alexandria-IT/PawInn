// Return today's calendar date in Bangkok.
export function today() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Bangkok",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}
// Add calendar days to an ISO date.
export function addDays(value, count) {
  const date = new Date(value + "T00:00:00Z");
  date.setUTCDate(date.getUTCDate() + count);
  return Number.isFinite(+date) ? date.toISOString().slice(0, 10) : "";
}
// Count nights between check-in and check-out.
export const nights = (start, end) =>
  (Date.parse(end) - Date.parse(start)) / 86400000;
// Format an amount in Thai baht.
export const money = (value) =>
  new Intl.NumberFormat("en-TH", { style: "currency", currency: "THB" }).format(
    value,
  );
// Format a date for display in the portal.
export function dateLabel(value) {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isFinite(+date)
    ? new Intl.DateTimeFormat("en-GB", {
        day: "numeric",
        month: "short",
        year: "numeric",
        timeZone: "Asia/Bangkok",
      }).format(date)
    : "—";
}
// Pick the illustration for the room type.
export function roomImage(room) {
  if (room.species === "Cat") return "cat-loft.svg";
  return /garden/i.test(room.roomName || room.name)
    ? "garden-suite.svg"
    : "cozy-den.svg";
}
// Accept sign-in return URLs only for known pages on this origin.
export function nextPath(fallback = "/pages/bookings.html") {
  try {
    const value = new URLSearchParams(location.search).get("next");
    if (!value) return fallback;
    const url = new URL(value, location.origin);
    const allowed = [
      "/",
      "/index.html",
      "/pages/pets.html",
      "/pages/rooms.html",
      "/pages/bookings.html",
      "/pages/pet-updates.html",
      "/pages/checkout.html",
      "/pages/staff-dashboard.html",
    ];
    return url.origin === location.origin && allowed.includes(url.pathname)
      ? url.pathname + url.search
      : fallback;
  } catch {
    return fallback;
  }
}
// Send a message to the notification store.
export function toast(message) {
  window.dispatchEvent(new CustomEvent("pawinn:toast", { detail: message }));
}
// Open sign-in and remember the current page.
export function goToLogin() {
  location.href =
    "/pages/login.html?next=" +
    encodeURIComponent(location.pathname + location.search);
}
