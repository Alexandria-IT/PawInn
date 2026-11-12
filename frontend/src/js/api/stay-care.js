import { getToken } from "./account.js";
import { request } from "./client.js";

// Send a booking-scoped care request with the active session.
function careRequest(bookingId, suffix = "", options = {}) {
  return request(`bookings/${encodeURIComponent(bookingId)}/care${suffix}`, {
    ...options,
    token: getToken(),
  });
}

// Read the care history visible to the active session.
export const readStayCare = (bookingId) => careRequest(bookingId);

// Record an actual arrival or pickup time.
export const recordAttendance = (bookingId, kind, at) =>
  careRequest(bookingId, `/${kind}`, { method: "PATCH", body: { at } });

// Publish or correct the day's report, retaining existing photos when omitted.
export function saveDailyReport(bookingId, date, message, photos) {
  const form = new FormData();
  form.set("message", message);
  for (const photo of photos) form.append("photo", photo);
  return careRequest(bookingId, `/days/${encodeURIComponent(date)}/report`, {
    method: "PUT",
    body: form,
  });
}

// Create a care event or correct the selected event for that day.
export function saveCareEvent(bookingId, date, eventId, body) {
  const eventsPath = `/days/${encodeURIComponent(date)}/events`;
  return careRequest(
    bookingId,
    eventId ? `${eventsPath}/${encodeURIComponent(eventId)}` : eventsPath,
    { method: eventId ? "PATCH" : "POST", body },
  );
}

// Fetch a private report photo without exposing the token in its URL.
export const fetchStayCarePhoto = (bookingId, photoId, signal) =>
  careRequest(bookingId, `/photos/${encodeURIComponent(photoId)}`, {
    asBlob: true,
    signal,
  });
