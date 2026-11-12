import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile, cp, readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { build } from "esbuild";
const root = fileURLToPath(new URL("../", import.meta.url));
await mkdir(path.join(root, "dist/assets"), { recursive: true });
await build({
  entryPoints: [path.join(root, "src/js/app.js")],
  outfile: path.join(root, "dist/assets/app.js"),
  bundle: true,
  minify: true,
  sourcemap: true,
  target: ["es2022"],
  format: "iife",
});
// Version the script URL so updated pages don't load a cached older bundle.
const appVersion = createHash("sha256")
  .update(await readFile(path.join(root, "dist/assets/app.js")))
  .digest("hex")
  .slice(0, 16);
const css = spawnSync(
  process.execPath,
  [
    path.join(root, "node_modules/@tailwindcss/cli/dist/index.mjs"),
    "-i",
    path.join(root, "src/css/styles.css"),
    "-o",
    path.join(root, "dist/assets/styles.css"),
    "--minify",
  ],
  { stdio: "inherit", cwd: root },
);
if (css.status !== 0) process.exit(css.status || 1);
// Expand shared HTML once at build time so each page can load directly.
const partials = {};
for (const filename of await readdir(path.join(root, "src/partials")))
  partials[filename.replace(".html", "")] = await readFile(
    path.join(root, "src/partials", filename),
    "utf8",
  );
for (const dir of ["", "pages"]) {
  await mkdir(path.join(root, "dist", dir), { recursive: true });
  for (const filename of await readdir(path.join(root, "src", dir)))
    if (filename.endsWith(".html")) {
      let html = await readFile(path.join(root, "src", dir, filename), "utf8");
      html = html.replace(
        /<!-- include:([\w-]+) -->/g,
        /* Resolve the include to its shared HTML partial. */ (_, name) => {
          if (!partials[name]) throw new Error(`Missing partial: ${name}`);
          return partials[name];
        },
      );
      if (html.includes("<!-- include:"))
        throw new Error("Unresolved HTML include.");
      // A fresh URL bypasses copies of Home cached by older deployments.
      html = html.replaceAll('href="/"', `href="/?v=${appVersion}"`);
      html = html.replace(
        'src="/assets/app.js"',
        'src="/assets/app.js?v=' + appVersion + '"',
      );
      await writeFile(path.join(root, "dist", dir, filename), html);
    }
}
await cp(path.join(root, "src/assets"), path.join(root, "dist/assets"), {
  recursive: true,
});
console.log("Built PawInn frontend → dist/");
