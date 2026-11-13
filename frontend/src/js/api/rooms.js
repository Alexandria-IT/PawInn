import { request } from "./client.js";
import { getToken } from "./account.js";
import { roomImage } from "../helpers.js";
// Load room types for the frontend catalog.
export async function catalog() {
  const types = await request("room-types");
  return types.map(
    /* Add the display fields used by room cards. */ (t) => ({
      ...t,
      subtitle: t.description,
      rate: t.pricePerNight,
      image: roomImage(t),
    }),
  );
}
// Combine catalog details with availability for the selected dates.
export async function listRooms(start, end) {
  const query = new URLSearchParams({ start, end });
  const [types, availability] = await Promise.all([
    catalog(),
    request("availability?" + query),
  ]);
  const counts = new Map(
    availability.map(
      /* Index availability by room type ID. */ (x) => [
        x.roomTypeId,
        x.available,
      ],
    ),
  );
  return types.map(
    /* Add the matching availability count to each room type. */ (t) => ({
      ...t,
      available: counts.get(t.id) || 0,
    }),
  );
}
// Fetch physical room inventory.
export const inventory = () => request("rooms/inventory", { token: getToken() });
// Schedule or remove a temporary closure for one room.
export const scheduleClosure = (id, dates) =>
  request("rooms/" + encodeURIComponent(id) + "/closures", {
    method: "POST", token: getToken(), body: dates,
  });
export const removeClosure = (id, closureId) =>
  request("rooms/" + encodeURIComponent(id) + "/closures/" + encodeURIComponent(closureId), {
    method: "DELETE", token: getToken(),
  });
// Set the active status of a physical room.
export const setActive = (id, isActive) =>
  request("rooms/" + encodeURIComponent(id), {
    method: "PATCH",
    token: getToken(),
    body: { isActive },
  });
