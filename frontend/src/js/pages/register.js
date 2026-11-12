import { register } from "../api/account.js";
import { nextPath } from "../helpers.js";
// Create customer registration form state.
export default () => ({
  name: "",
  email: "",
  phone: "",
  password: "",
  confirm: "",
  error: "",
  busy: false,
  // Validate the passwords and register the customer.
  async submit() {
    if (this.busy) return;
    this.error = "";
    if (
      this.password.length < 8 ||
      new TextEncoder().encode(this.password).length > 72
    ) {
      this.error =
        "Use a password with at least 8 characters and at most 72 bytes.";
      return;
    }
    if (this.password !== this.confirm) {
      this.error = "Your passwords do not match.";
      return;
    }
    this.busy = true;
    try {
      await register(this);
      this.password = this.confirm = "";
      location.href = nextPath("/pages/pets.html");
    } catch (error) {
      this.error = error.message;
      this.busy = false;
    }
  },
});
