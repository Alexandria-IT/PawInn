import { updatePhone } from "../api/account.js";
import { listRooms } from "../api/rooms.js";
import { reserve } from "../api/bookings.js";
import { today, addDays, goToLogin } from "../helpers.js";
// Create room search and reservation state.
export default () => ({
  bookingMode: true,
  loading: false,
  start: addDays(today(), 10),
  end: addDays(today(), 13),
  species: "All",
  searchPetId: "",
  sort: "recommended",
  query: "",
  results: [],
  error: "",
  checked: false,
  selected: null,
  petId: "",
  specialCare: "",
  phone: "",
  reserveError: "",
  busy: false,
  // Restore search filters from the URL.
  init() {
    const p = new URLSearchParams(location.search);
    this.start = p.get("start") || this.start;
    this.end = p.get("end") || this.end;
    this.species = ["Dog", "Cat"].includes(p.get("species"))
      ? p.get("species")
      : "All";
    this.search();
  },
  // Load availability for the current dates and update the URL.
  async search() {
    if (this.loading) return;
    this.loading = true;
    const { start, end } = this;
    try {
      const results = await listRooms(start, end);
      // The inputs may have changed while availability was being fetched.
      if (this.start !== start || this.end !== end) return;
      this.results = results;
      this.error = "";
      this.checked = true;
      const url = new URL(location.href);
      url.searchParams.set("start", this.start);
      url.searchParams.set("end", this.end);
      url.searchParams.set("species", this.species);
      history.replaceState(null, "", url);
    } catch (error) {
      this.error = error.message;
      this.checked = false;
      this.results = [];
    } finally {
      this.loading = false;
    }
  },
  // Derive the room category from the selected pet profile.
  selectSearchPet() {
    const pet = this.$store.portal.pets.find((p) => p.id === this.searchPetId);
    this.species = pet?.species ?? "All";
  },
  // Apply the room filters and selected sorting.
  get filtered() {
    const rooms = this.results.filter(
      /* Match room species and the search text. */ (r) =>
        (this.species === "All" || r.species === this.species) &&
        `${r.name} ${r.description || ""}`
          .toLowerCase()
          .includes(this.query.toLowerCase()),
    );
    return this.sort === "price"
      ? rooms.sort(
          /* Sort by lowest nightly rate first. */ (a, b) => a.rate - b.rate,
        )
      : rooms;
  },
  // Return pets compatible with the selected room.
  get suitablePets() {
    return this.$store.portal.pets.filter(
      /* Match the pet species to the room type. */ (p) =>
        p.species === this.selected?.species,
    );
  },
  // Open the reservation form for a signed-in customer.
  choose(room) {
    if (!this.$store.portal.user) {
      goToLogin();
      return;
    }
    if (this.$store.portal.user.role !== "CUSTOMER") {
      this.error = "Sign in as a customer to book a stay.";
      return;
    }
    this.selected = room;
    this.petId = this.suitablePets.find((p) => p.id === this.searchPetId)?.id ?? this.suitablePets[0]?.id ?? "";
    this.specialCare = "";
    this.phone = "";
    this.reserveError = "";
  },
  // Reserve the room and open checkout.
  async book() {
    if (this.busy) return;
    this.busy = true;
    try {
      if (!this.$store.portal.user.phone?.trim()) {
        this.$store.portal.user = await updatePhone(this.phone);
      }
      const b = await reserve(
        this.petId,
        this.selected.id,
        this.start,
        this.end,
        this.specialCare,
      );
      location.href = `/pages/checkout.html?booking=${encodeURIComponent(b.id)}`;
    } catch (error) {
      this.reserveError = error.message;
      this.busy = false;
      this.search();
    }
  },
});
