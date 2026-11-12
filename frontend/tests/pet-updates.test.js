import assert from "node:assert/strict";
import { test } from "node:test";
import session from "../src/js/stores/session.js";

test("new pet updates show until viewed and read markers stay with the account", async (t) => {
  const saved = new Map();
  const document = { body: { dataset: { page: "pet-updates" } }, visibilityState: "visible" };
  const globals = {
    document,
    localStorage: {
      getItem: (key) => saved.get(key) ?? null,
      setItem: (key, value) => saved.set(key, value),
    },
    sessionStorage: { getItem: () => "test-token" },
  };
  for (const [key, value] of Object.entries(globals)) {
    const original = Object.getOwnPropertyDescriptor(globalThis, key);
    Object.defineProperty(globalThis, key, { value, configurable: true });
    t.after(() => {
      if (original) Object.defineProperty(globalThis, key, original);
      else delete globalThis[key];
    });
  }
  let latest = "report:1";
  t.mock.method(globalThis, "fetch", async () =>
    Response.json({ data: { updates: [{ id: latest }] } }),
  );

  const store = session();
  const customer = { id: "1", role: "CUSTOMER" };
  store.user = customer;
  store.setPetUpdateUser(customer);
  await store.refreshPetUpdates();
  assert.equal(store.hasUnreadPetUpdates, true);
  store.notePetUpdates(latest);
  assert.equal(store.hasUnreadPetUpdates, false);

  latest = "2";
  document.visibilityState = "hidden";
  store.notePetUpdates(latest);
  assert.equal(store.hasUnreadPetUpdates, true);
  document.visibilityState = "visible";
  store.notePetUpdates(latest);
  assert.equal(store.hasUnreadPetUpdates, false);

  const other = { id: "2", role: "CUSTOMER" };
  store.user = other;
  store.setPetUpdateUser(other);
  await store.refreshPetUpdates();
  assert.equal(store.hasUnreadPetUpdates, true);

  store.user = customer;
  store.setPetUpdateUser(customer);
  await store.refreshPetUpdates();
  assert.equal(store.hasUnreadPetUpdates, false);
});
