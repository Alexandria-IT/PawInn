import Alpine from "alpinejs";
import focus from "@alpinejs/focus";
import portal from "./stores/session.js";
import ui from "./stores/ui.js";
import shell from "./components/navigation.js";
import { installAlerts } from "./components/alerts.js";
import login from "./pages/login.js";
import register from "./pages/register.js";
import pets from "./pages/pets.js";
import rooms from "./pages/rooms.js";
import bookings from "./pages/bookings.js";
import checkout from "./pages/checkout.js";
import staff from "./pages/staff-dashboard.js";
import admin from "./pages/admin.js";
import stayCare, { stayCarePhoto } from "./pages/stay-care.js";
import petUpdates, { petUpdatePhoto } from "./pages/pet-updates.js";
import { startLiveBookingUpdates } from "./api/live-bookings.js";
Alpine.plugin(focus);
Alpine.store("portal", portal());
Alpine.store("ui", ui());
for (const [name, component] of Object.entries({
  shell,
  login,
  register,
  pets,
  rooms,
  bookings,
  checkout,
  staff,
  admin,
  stayCare,
  stayCarePhoto,
  petUpdates,
  petUpdatePhoto,
}))
  Alpine.data(name, component);
installAlerts(Alpine);
Alpine.start();

const bookingHistoryPages = ["bookings", "checkout", "staff-dashboard"];
const page = document.body.dataset.page;
{
  const portalStore = Alpine.store("portal");
  let refreshTimer;
  startLiveBookingUpdates(
    (change) => {
      window.dispatchEvent(new CustomEvent("pawinn:booking-change", { detail: change }));
      if (page !== "pet-updates" && ["update", "report", "sync"].includes(change.area))
        portalStore.refreshPetUpdates();
      if (page !== "pet-updates" && bookingHistoryPages.includes(page) &&
          ["booking", "sync"].includes(change.area)) {
        clearTimeout(refreshTimer);
        refreshTimer = setTimeout(() => Alpine.store("portal").refresh(), 75);
      }
    },
    () => Alpine.store("portal").refresh(),
  );
}

window.addEventListener("storage", (event) => {
  const store = Alpine.store("portal");
  if (event.key === store.petUpdateKey || event.key === null)
    store.syncSeenPetUpdates();
});
window.addEventListener(
  "pageshow",
  /* Refresh the session when browser history restores a page. */ (event) => {
    if (event.persisted) Alpine.store("portal").refresh();
  },
);
