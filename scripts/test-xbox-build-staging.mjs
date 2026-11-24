import test from "node:test";
import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import { constants as fsConstants } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { inspectEnvScript } from "./hydrate-official-env.mjs";
import { REQUIRED_UWP_ASSETS } from "./stage-xbox-webcode.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");
const uwpDir = path.join(rootDir, "xbox-uwp", "NuvioXbox");
const webCodeDir = path.join(uwpDir, "WebCode");
const assetsDir = path.join(uwpDir, "Assets");

function readPngDimensions(buffer) {
  assert.equal(buffer.subarray(0, 8).toString("hex"), "89504e470d0a1a0a", "Expected valid PNG header");
  return {
    width: buffer.readUInt32BE(16),
    height: buffer.readUInt32BE(20)
  };
}

test("staged WebCode contains built bundle and valid hydrated nuvio.env.js", async () => {
  for (const relPath of ["index.html", "app.bundle.js", "core-js.bundle.js", "nuvio.env.js"]) {
    await access(path.join(webCodeDir, relPath), fsConstants.R_OK);
  }

  const indexHtml = await readFile(path.join(webCodeDir, "index.html"), "utf8");
  assert.match(indexHtml, /platform=xbox/);
  assert.match(indexHtml, /nuvio\.env\.js/);

  const envSource = await readFile(path.join(webCodeDir, "nuvio.env.js"), "utf8");
  const inspection = inspectEnvScript(envSource);
  assert.equal(inspection.valid, true, "Hydrated nuvio.env.js must define non-empty Supabase runtime config");
  assert.equal(inspection.hasSupabaseUrl, true);
  assert.equal(inspection.hasSupabaseAnonKey, true);
});

test("UWP branding PNG assets exist with exact manifest dimensions", async () => {
  for (const item of REQUIRED_UWP_ASSETS) {
    const filePath = path.join(assetsDir, item.file);
    const bytes = await readFile(filePath);
    const dims = readPngDimensions(bytes);
    assert.equal(dims.width, item.width, `${item.file} width mismatch`);
    assert.equal(dims.height, item.height, `${item.file} height mismatch`);
  }
});
