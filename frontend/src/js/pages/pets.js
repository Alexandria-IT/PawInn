import { savePet, deletePet, setPetArchived } from "../api/account.js";
import { toast } from "../helpers.js";
// Create an empty pet form with the default species.
const blank = () => ({
  id: "",
  name: "",
  species: "Dog",
  breed: "",
  birthDate: "",
  notes: "",
});
// Create pet list and form state.
export default () => ({
  editing: false,
  busy: false,
  deleting: null,
  restoreError: "",
  form: blank(),
  error: "",
  removeError: "",
  filter: "All",
  // Return pets matching the selected species filter.
  get pets() {
    return this.$store.portal.pets.filter(
      /* Include all pets or match the selected species. */ (p) =>
        this.filter === "All" || p.species === this.filter,
    );
  },
  // Open a new form or copy the selected pet for editing.
  open(pet) {
    this.form = pet ? { ...pet } : blank();
    this.error = "";
    this.editing = true;
  },
  // Save the form and refresh pet data.
  async save() {
    if (this.busy) return;
    this.error = "";
    this.busy = true;
    try {
      await savePet(this.form);
      await this.$store.portal.refresh();
      this.editing = false;
      toast("Pet profile saved. A little more like home.");
    } catch (error) {
      this.error = error.message;
      if (error.status === 401) await this.$store.portal.refresh();
    } finally {
      this.busy = false;
    }
  },
  // Delete an unused pet or archive one with booking history.
  async remove() {
    if (this.busy || !this.deleting) return;
    this.removeError = "";
    this.busy = true;
    try {
      const { id, bookingState } = this.deleting;
      const archive = bookingState === "HISTORY";
      if (archive) await setPetArchived(id, true);
      else await deletePet(id);
      await this.$store.portal.refresh();
      this.deleting = null;
      toast(archive ? "Pet profile archived." : "Pet profile deleted.");
    } catch (error) {
      this.removeError = error.message;
      if ([401, 409].includes(error.status)) await this.$store.portal.refresh();
    } finally {
      this.busy = false;
    }
  },
  // Return an archived pet to the active profile list and booking pickers.
  async restore(pet) {
    if (this.busy) return;
    this.restoreError = "";
    this.busy = true;
    try {
      await setPetArchived(pet.id, false);
      await this.$store.portal.refresh();
      this.filter = "All";
      toast("Pet profile restored.");
    } catch (error) {
      this.restoreError = error.message;
      if (error.status === 401) await this.$store.portal.refresh();
    } finally {
      this.busy = false;
    }
  },
  // Format the pet's age in months or years.
  age(birthDate) {
    if (!birthDate) return "Age not added";
    const birth = new Date(birthDate + "T00:00:00"),
      now = new Date();
    let months =
      (now.getFullYear() - birth.getFullYear()) * 12 +
      now.getMonth() -
      birth.getMonth() -
      (now.getDate() < birth.getDate() ? 1 : 0);
    months = Math.max(0, months);
    const years = Math.floor(months / 12);
    return months < 12
      ? `${months} ${months === 1 ? "month" : "months"} old`
      : `${years} ${years === 1 ? "year" : "years"} old`;
  },
});
