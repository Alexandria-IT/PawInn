import { catalog } from "../api/rooms.js";
import { logout } from "../api/account.js";
import {
  money,
  dateLabel,
  today,
  addDays,
  nights,
  roomImage,
} from "../helpers.js";
// Create shared navigation and homepage state.
export default () => ({
  mobileOpen: false,
  profileOpen: false,
  featured: [],
  catalogError: "",
  // Load the homepage room catalog.
  async loadCatalog() {
    try {
      this.featured = await catalog();
      this.catalogError = "";
    } catch (error) {
      this.catalogError = error.message;
    }
  },
  money,
  dateLabel,
  today,
  addDays,
  nights,
  roomImage,
  // Check the active page against its body marker.
  active(page) {
    return (document.body.dataset.page || "home") === page;
  },
  // Choose whether to show the public navigation.
  get showSiteNavigation() {
    const { ready, user } = this.$store.portal;
    return !this.active("staff-dashboard") || (ready && user?.role !== "STAFF");
  },
  // Label the account in the profile menu.
  get accountLabel() {
    const labels = { STAFF: "Staff account", CUSTOMER: "Customer account" };
    return labels[this.$store.portal.user?.role] || "";
  },
  // Build the account avatar initials.
  get initials() {
    return (this.$store.portal.user?.name || "Guest")
      .split(" ")
      .map(/* Take the first character of each name part. */ (n) => n[0])
      .slice(0, 2)
      .join("")
      .toUpperCase();
  },
  // End the session and return to sign-in.
  signOut() {
    logout();
    location.href = "/pages/login.html";
  },
  // Map a status to its badge classes.
  badge(status) {
    return `badge badge-${status.toLowerCase()}`;
  },
  // Open the room search with the entered stay details.
  searchStay(event) {
    const form = new FormData(event.target);
    const params = new URLSearchParams(form);
    location.href = `/pages/rooms.html?${params}`;
  },
});
