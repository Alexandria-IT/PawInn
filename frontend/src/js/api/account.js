import { request } from "./client.js";

const tokenKey = "pawinn.account.token.v1";
// Read the token stored for this browser tab.
export const getToken = () => sessionStorage.getItem(tokenKey);
// Store the token and return the signed-in user.
function remember({ user, token }) {
  sessionStorage.setItem(tokenKey, token);
  return user;
}
// Authenticate with an email and password.
export async function login(email, password) {
  return remember(
    await request("auth/login", { method: "POST", body: { email, password } }),
  );
}
// Create a customer account and start its session.
export async function register({ name, email, password, phone }) {
  return remember(
    await request("auth/register", {
      method: "POST",
      body: { name, email, password, phone },
    }),
  );
}
// Remove the token from this tab.
export function logout() {
  sessionStorage.removeItem(tokenKey);
}
// Fetch the account associated with the token.
export const currentUser = (token) => request("users/me", { token });
// Fetch the signed-in customer's pets.
export const listPets = (token) => request("pets", { token });
// Send only supported pet fields and choose create or update.
export function savePet(form) {
  const { name, species, breed, birthDate, notes } = form;
  return request(form.id ? "pets/" + encodeURIComponent(form.id) : "pets", {
    method: form.id ? "PATCH" : "POST",
    body: { name, species, breed, birthDate, notes },
    token: getToken(),
  });
}
// Request deletion of an owned pet.
export function deletePet(id) {
  return request("pets/" + encodeURIComponent(id), {
    method: "DELETE",
    token: getToken(),
  });
}
