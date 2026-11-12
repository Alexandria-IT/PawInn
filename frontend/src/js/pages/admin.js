import { createStaff, listAccounts, listAccountAudit, updateAccount } from "../api/admin.js";
import { toast } from "../helpers.js";

const roles = { ADMIN: "Administrator", STAFF: "Staff", CUSTOMER: "Customer" };
const statuses = { ACTIVE: "Active", SUSPENDED: "Suspended" };
const actions = {
  ADMIN_BOOTSTRAPPED: "Administrator created",
  STAFF_CREATED: "Staff account created",
  STAFF_GRANTED: "Staff access granted",
  STAFF_REVOKED: "Staff access revoked",
  ACCOUNT_SUSPENDED: "Account suspended",
  ACCOUNT_REACTIVATED: "Account reactivated",
};
const auditTime = new Intl.DateTimeFormat("en-GB", {
  dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Bangkok",
});

// Create the account management and audit views.
export default () => ({
  view: "accounts",
  filters: { q: "", role: "", status: "" },
  appliedFilters: {},
  accounts: [],
  nextAccount: null,
  audit: [],
  nextAudit: null,
  auditTarget: null,
  showCreate: false,
  staff: { name: "", email: "", password: "" },
  busy: false,
  error: "",
  roles,
  statuses,
  actions,
  // Load account data only after the admin session is verified.
  init() {
    this.$watch("$store.portal.user?.role", (role) => {
      if (role === "ADMIN") this.search();
    });
    if (this.$store.portal.user?.role === "ADMIN") this.search();
  },
  // Track the current request and expose failures in the page.
  async run(operation) {
    if (this.busy) return;
    this.busy = true;
    this.error = "";
    try {
      await operation();
    } catch (error) {
      this.error = error.message;
      if (error.status === 401) await this.$store.portal.refresh();
    } finally {
      this.busy = false;
    }
  },
  // Apply the selected filters and start at the first page.
  search() {
    return this.run(async () => {
      this.appliedFilters = { ...this.filters };
      await this.fetchAccounts();
    });
  },
  // Refresh account results or append the next page of the same search.
  async fetchAccounts(append = false) {
    const page = await listAccounts({ ...this.appliedFilters, before: append ? this.nextAccount : null });
    this.accounts = append ? this.accounts.concat(page.users) : page.users;
    this.nextAccount = page.nextBefore;
  },
  // Open the latest audit history, with an optional account filter.
  openAudit(account = null) {
    return this.run(async () => {
      this.view = "audit";
      this.auditTarget = account;
      this.audit = [];
      this.nextAudit = null;
      await this.fetchAudit();
    });
  },
  // Refresh audit results or append older entries.
  async fetchAudit(append = false) {
    const page = await listAccountAudit({ userId: this.auditTarget?.id, before: append ? this.nextAudit : null });
    this.audit = append ? this.audit.concat(page.entries) : page.entries;
    this.nextAudit = page.nextBefore;
  },
  // Hide the form and remove any entered credentials.
  closeCreate() {
    this.showCreate = false;
    this.staff = { name: "", email: "", password: "" };
  },
  // Create a staff account from the form.
  submitStaff() {
    return this.run(async () => {
      const account = await createStaff(this.staff);
      this.closeCreate();
      toast(`Staff account created for ${account.name}.`);
      await this.fetchAccounts();
    });
  },
  // Confirm and apply the selected account change.
  change(account, updates, action) {
    if (this.busy || !window.confirm(`${action} for ${account.name} (${account.email})?`)) return;
    return this.run(async () => {
      await updateAccount(account.id, updates);
      toast(`Account updated for ${account.name}.`);
      await this.fetchAccounts();
    });
  },
  // Format an audit time in the hotel's timezone.
  timeLabel(value) {
    return auditTime.format(new Date(value));
  },
  // Render recorded changes using the same terms as the account table.
  detailsLabel({ from, to, role, status, source }) {
    const labels = { ...roles, ...statuses };
    if (from && to) return `${labels[from]} → ${labels[to]}`;
    if (role && status) return `${labels[role]}, ${labels[status]}`;
    return source === "CLI" ? "Created from the command line" : "";
  },
});
