import { createHash } from "node:crypto";
import test from "node:test";
import assert from "node:assert/strict";
import { readFile, access } from "node:fs/promises";
const pages = [
  "index.html",
  ...[
    "login",
    "register",
    "pets",
    "rooms",
    "bookings",
    "checkout",
    "staff-dashboard",
  ].map(
    /* Convert each page name to its built path. */ (p) => `pages/${p}.html`,
  ),
];
test("all eight built pages resolve static navigation and local assets", /* Check that all built pages resolve their links and assets. */ async () => {
  for (const page of pages) {
    const html = await readFile(
      new URL(`../dist/${page}`, import.meta.url),
      "utf8",
    );
    assert.ok(!html.includes("<!-- include:"), `${page}: unresolved partial`);
    for (const [, link] of html.matchAll(/\s(?:src|href)="([^"]+)"/g)) {
      if (!link.startsWith("/")) continue;
      const pathname = new URL(link, "http://localhost").pathname;
      await access(
        new URL(
          `../dist${pathname === "/" ? "/index.html" : pathname}`,
          import.meta.url,
        ),
      );
    }
  }
});

test("pages reference the current JavaScript bundle by content version", /* Check that every page uses the current bundle version. */ async () => {
  const bundle = await readFile(
    new URL("../dist/assets/app.js", import.meta.url),
  );
  const version = createHash("sha256")
    .update(bundle)
    .digest("hex")
    .slice(0, 16);
  for (const page of pages) {
    const html = await readFile(
      new URL(`../dist/${page}`, import.meta.url),
      "utf8",
    );
    assert.ok(
      html.includes(`src="/assets/app.js?v=${version}"`),
      `${page}: script URL must change when the bundle changes`,
    );
  }
});
