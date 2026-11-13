import { login } from "../api/account.js";
import { nextPath } from "../helpers.js";
// Create the sign-in form state.
export default () => ({
  email: "",
  password: "",
  showPassword: false,
  error: "",
  busy: false,
  // Submit the credentials from the form.
  submit() {
    return this.signIn(this.email, this.password);
  },
  // Sign in and route the user to the appropriate page.
  async signIn(email, password) {
    if (this.busy) return;
    this.error = "";
    this.busy = true;
    try {
      const user = await login(email, password);
      this.password = "";
      const fallback =
        user.role === "STAFF"
          ? "/pages/staff-dashboard.html"
          : "/pages/pets.html";
      location.href = nextPath(fallback);
    } catch (error) {
      this.error = error.message;
      this.busy = false;
    }
  },
});
