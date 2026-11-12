import { currentUser, getToken, listPets, logout } from "../api/account.js";
import { listBookings } from "../api/bookings.js";

// Create the shared account, pet, and booking store.
export default () => ({
  user: null,
  pets: [],
  bookings: [],
  ready: false,
  error: "",
  revision: 0,
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
        this.pets = [];
        this.bookings = [];
        return;
      }
      const user = await currentUser(token);
      if (rev !== this.revision) return;
      this.user = user;
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
        this.pets = [];
        this.bookings = [];
        this.error = "Your session ended. Sign in again.";
      } else this.error = error.message;
    } finally {
      if (rev === this.revision) this.ready = true;
    }
  },
});
