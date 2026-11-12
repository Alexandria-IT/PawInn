import { listPetUpdates, fetchPetUpdatePhoto } from "../api/bookings.js";

// Load updates for the active customer and append older pages on request.
export default () => ({
  items: [],
  nextBefore: null,
  loaded: false,
  loading: false,
  error: "",
  requestNumber: 0,
  // Load once per customer session and discard data on sign-out.
  init() {
    this.$watch(
      "$store.portal.user?.id",
      /* Reload when the signed-in account changes. */ () => this.reset(),
    );
    this.reset();
  },
  // Invalidate outstanding requests and reload the active account.
  reset() {
    this.requestNumber++;
    this.items = [];
    this.nextBefore = null;
    this.loaded = false;
    this.loading = false;
    this.error = "";
    if (this.$store.portal.user?.role === "CUSTOMER") this.load();
  },
  // Fetch one page of the current customer's private feed.
  async load(before = null) {
    if (this.loading || this.$store.portal.user?.role !== "CUSTOMER") return;
    this.loading = true;
    this.error = "";
    const requestNumber = ++this.requestNumber;
    try {
      const result = await listPetUpdates(before);
      if (requestNumber !== this.requestNumber) return;
      this.items = before ? [...this.items, ...result.updates] : result.updates;
      this.nextBefore = result.nextBefore;
      this.loaded = true;
    } catch (error) {
      if (requestNumber === this.requestNumber) this.error = error.message;
    } finally {
      if (requestNumber === this.requestNumber) this.loading = false;
    }
  },
  // Format the time of an update in the hotel's local time zone.
  timestamp(value) {
    return new Intl.DateTimeFormat("en-GB", {
      dateStyle: "medium",
      timeStyle: "short",
      timeZone: "Asia/Bangkok",
    }).format(new Date(value));
  },
});

// Fetch a private photo with the customer's bearer token.
export function petUpdatePhoto(updateId) {
  const controller = new AbortController();
  return {
    source: "",
    error: "",
    // Create a browser-only URL for the authenticated image response.
    async init() {
      try {
        const photo = await fetchPetUpdatePhoto(updateId, controller.signal);
        if (!controller.signal.aborted)
          this.source = URL.createObjectURL(photo);
      } catch (error) {
        if (!controller.signal.aborted) this.error = error.message;
      }
    },
    // Release the photo if the feed changes or the page closes.
    destroy() {
      controller.abort();
      if (this.source) URL.revokeObjectURL(this.source);
    },
  };
}
