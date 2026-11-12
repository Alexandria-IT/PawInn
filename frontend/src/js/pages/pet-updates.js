import { listPetUpdates, fetchPetUpdatePhoto } from "../api/bookings.js";
import { fetchStayCarePhoto } from "../api/stay-care.js";
import { dateLabel } from "../helpers.js";

// Load updates for the active customer and append older pages on request.
export default () => ({
  items: [],
  nextBefore: null,
  loaded: false,
  loading: false,
  refreshing: false,
  refreshPending: false,
  error: "",
  requestNumber: 0,
  visibilityHandler: null,
  // Load once per customer session and discard data on sign-out.
  init() {
    this.$watch(
      "$store.portal.user?.id",
      /* Reload when the signed-in account changes. */ () => this.reset(),
    );
    this.visibilityHandler = () => {
      if (this.loaded && document.visibilityState === "visible")
        this.$store.portal.notePetUpdates(this.items[0]?.id ?? null);
    };
    document.addEventListener("visibilitychange", this.visibilityHandler);
    this.reset();
  },
  // Stop tracking visibility when this feed is removed.
  destroy() {
    document.removeEventListener("visibilitychange", this.visibilityHandler);
  },
  // Invalidate outstanding requests and reload the active account.
  reset() {
    this.requestNumber++;
    this.items = [];
    this.nextBefore = null;
    this.loaded = false;
    this.loading = false;
    this.refreshing = false;
    this.refreshPending = false;
    this.error = "";
    if (this.$store.portal.user?.role === "CUSTOMER") this.load();
  },
  // Fetch one page of the current customer's private feed.
  async load(before = null) {
    if (this.loading || this.refreshing || this.$store.portal.user?.role !== "CUSTOMER") return;
    this.loading = true;
    this.error = "";
    const requestNumber = ++this.requestNumber;
    try {
      const result = await listPetUpdates(before);
      if (requestNumber !== this.requestNumber) return;
      this.items = before ? [...this.items, ...result.updates] : result.updates;
      if (!before) this.$store.portal.notePetUpdates(this.items[0]?.id ?? null);
      this.nextBefore = result.nextBefore;
      this.loaded = true;
    } catch (error) {
      if (requestNumber === this.requestNumber) this.error = error.message;
    } finally {
      if (requestNumber === this.requestNumber) {
        this.loading = false;
        if (this.refreshPending) this.refreshFeed();
      }
    }
  },
  // Refresh the visible feed in place when a report or update is published.
  refreshFromEvent({ area }) {
    if (["update", "report", "sync"].includes(area)) this.refreshFeed();
  },
  // Keep older pages the customer already loaded when refreshing the newest items.
  async refreshFeed() {
    if (this.$store.portal.user?.role !== "CUSTOMER") return;
    if (this.loading || this.refreshing) {
      this.refreshPending = true;
      return;
    }
    this.refreshPending = false;
    this.refreshing = true;
    const requestNumber = ++this.requestNumber;
    const oldest = this.items.at(-1)?.id;
    const updates = [];
    let nextBefore = null;
    try {
      do {
        const page = await listPetUpdates(nextBefore);
        if (requestNumber !== this.requestNumber) return;
        updates.push(...page.updates);
        nextBefore = page.nextBefore;
      } while (oldest && nextBefore && !updates.some(({ id }) => id === oldest));
      this.items = updates;
      this.$store.portal.notePetUpdates(updates[0]?.id ?? null);
      this.nextBefore = nextBefore;
      this.loaded = true;
      this.error = "";
    } catch {
      // Keep the existing feed visible until the next update or manual refresh.
    } finally {
      if (requestNumber === this.requestNumber) {
        this.refreshing = false;
        if (this.refreshPending) this.refreshFeed();
      }
    }
  },
  reportDateLabel: dateLabel,
  // Link to this booking's care history in My bookings.
  careLink(bookingId) {
    return "/pages/bookings.html?careBooking=" + encodeURIComponent(bookingId);
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
export function petUpdatePhoto(update) {
  const controller = new AbortController();
  return {
    source: "",
    error: "",
    // Create a browser-only URL for the authenticated image response.
    async init() {
      try {
        const { signal } = controller;
        const photo = await (update.kind === "report"
          ? fetchStayCarePhoto(update.bookingId, update.photoId, signal)
          : fetchPetUpdatePhoto(update.id, signal));
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
