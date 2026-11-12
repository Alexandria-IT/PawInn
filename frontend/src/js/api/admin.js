import { getToken } from "./account.js";
import { request } from "./client.js";

// Send only populated filters to the Account service.
function queryString(filters) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(filters)) {
    if (value) params.set(key, value);
  }
  return params.size ? `?${params}` : "";
}

// Search the accounts visible to the current admin.
export const listAccounts = (filters) =>
  request("admin/users" + queryString(filters), { token: getToken() });

// Create an account with staff access.
export const createStaff = (body) =>
  request("admin/users", { method: "POST", body, token: getToken() });

// Set the selected account's role or status.
export const updateAccount = (id, body) =>
  request("admin/users/" + encodeURIComponent(id), { method: "PATCH", body, token: getToken() });

// Read administrative changes, optionally for one account.
export const listAccountAudit = (filters) =>
  request("admin/audit" + queryString(filters), { token: getToken() });
