import { currentUser, getToken, listPets, logout } from "../api/account.js";
import { listBookings, listPetUpdates } from "../api/bookings.js";

// Create the shared account, pet, and booking store.
export default () => ({
  user: null,
  pets: [],
  bookings: [],
  ready: false,
  error: "",
  revision: 0,
  petUpdateUserId: null,
  latestPetUpdateId: null,
  seenPetUpdateId: null,
  petUpdateRevision: 0,

  // Show a dot until this customer views the most recent item in the feed.
  get hasUnreadPetUpdates() {
    return this.user?.role === "CUSTOMER" && Boolean(
      this.latestPetUpdateId && this.latestPetUpdateId !== this.seenPetUpdateId,
    );
  },

  // Keep read markers isolated by account and shared across this browser's tabs.
  get petUpdateKey() {
    return "pawinn.pet-updates.seen." + this.petUpdateUserId;
  },
  syncSeenPetUpdates() {
    if (!this.petUpdateUserId) return;
    try {
      this.seenPetUpdateId = localStorage.getItem(this.petUpdateKey);
    } catch {
      // The current tab still works when persistent storage is unavailable.
    }
  },

  // Reset the indicator whenever the active customer changes.
  setPetUpdateUser(user) {
    const id = user?.role === "CUSTOMER" ? user.id : null;
    if (this.petUpdateUserId === id) return;
    this.petUpdateRevision++;
    this.petUpdateUserId = id;
    this.latestPetUpdateId = null;
    this.seenPetUpdateId = null;
    this.syncSeenPetUpdates();
    if (id && document.body.dataset.page !== "pet-updates") this.refreshPetUpdates();
  },

  // Check the head of the customer's feed after a new update or reconnection.
  async refreshPetUpdates() {
    if (!this.petUpdateUserId) return;
    const revision = ++this.petUpdateRevision;
    try {
      const { updates } = await listPetUpdates();
      if (revision === this.petUpdateRevision)
        this.latestPetUpdateId = updates[0]?.id ?? null;
    } catch {
      // Preserve the indicator until the next successful check.
    }
  },

  // Mark what the customer has actually opened on the Pet Updates page.
  notePetUpdates(latestId) {
    if (!this.petUpdateUserId) return;
    this.petUpdateRevision++;
    this.latestPetUpdateId = latestId;
    if (!latestId || document.visibilityState !== "visible") return;
    this.seenPetUpdateId = latestId;
    try {
      localStorage.setItem(this.petUpdateKey, latestId);
    } catch {
      // Keep the read marker for this tab.
    }
  },
  // Start session loading when Alpine initializes the store.
  init() {
    this.refresh();
  },
  // Load current account data and handle expired sessions.
  async refresh() {
    // A slower request must never overwrite a newer refresh.
    const rev = ++this.revision;
    this.error = "";
    try {
      const token = getToken();
      if (!token) {
        this.user = null;
        this.setPetUpdateUser(null);
        this.pets = [];
        this.bookings = [];
        return;
      }
      const user = await currentUser(token);
      if (rev !== this.revision) return;
      this.user = user;
      this.setPetUpdateUser(user);
      // Fetch booking history only on pages that display it.
      const needsBookings = [
        "bookings",
        "checkout",
        "staff-dashboard",
      ].includes(document.body.dataset.page);
      const [pets, bookings] = await Promise.all([
        user.role === "CUSTOMER" ? listPets(token) : [],
        needsBookings ? listBookings() : [],
      ]);
      if (rev !== this.revision) return;
      this.pets = pets.map(
        /* Supply the display defaults expected by pet forms. */ (p) => ({
          ...p,
          avatar: p.species === "Cat" ? "cat" : "dog",
          breed: p.breed ?? "",
          birthDate: p.birthDate ?? "",
          notes: p.notes ?? "",
        }),
      );
      this.bookings = bookings;
    } catch (error) {
      if (rev !== this.revision) return;
      if (error.status === 401) {
        logout();
        this.user = null;
        this.setPetUpdateUser(null);
        this.pets = [];
        this.bookings = [];
        this.error = "Your session ended. Sign in again.";
      } else this.error = error.message;
    } finally {
      if (rev === this.revision) this.ready = true;
    }
  },
});
