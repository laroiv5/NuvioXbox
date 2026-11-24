import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { constants as fsConstants } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import JSZip from "jszip";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");
const distDir = path.join(rootDir, "dist");
const cacheDir = path.join(rootDir, ".cache");
const cachedWgtPath = path.join(cacheDir, "official-release.wgt");
const targetEnvPath = path.join(distDir, "nuvio.env.js");

const LATEST_RELEASE_API = "https://api.github.com/repos/NuvioMedia/NuvioTVSmart/releases/latest";
const FALLBACK_WGT_URL =
  "https://github.com/NuvioMedia/NuvioTVSmart/releases/download/1.4.6/NuvioTV-Tizen-1.4.6.wgt";

async function fileReadable(filePath) {
  try {
    await access(filePath, fsConstants.R_OK);
    return true;
  } catch {
    return false;
  }
}

export function inspectEnvScript(scriptSource) {
  if (!scriptSource || typeof scriptSource !== "string") {
    return { valid: false, hasSupabaseUrl: false, hasSupabaseAnonKey: false };
  }
  try {
    const sandbox = { globalThis: {}, window: {} };
    sandbox.globalThis = sandbox;
    sandbox.window = sandbox;
    vm.runInNewContext(scriptSource, sandbox, { timeout: 1000 });
    const env = sandbox.__NUVIO_ENV__ || sandbox.window?.__NUVIO_ENV__ || {};
    const hasSupabaseUrl = Boolean(String(env.NUVIO_SUPABASE_URL || "").trim());
    const hasSupabaseAnonKey = Boolean(String(env.NUVIO_SUPABASE_ANON_KEY || "").trim());
    return {
      valid: hasSupabaseUrl && hasSupabaseAnonKey,
      hasSupabaseUrl,
      hasSupabaseAnonKey
    };
  } catch {
    return { valid: false, hasSupabaseUrl: false, hasSupabaseAnonKey: false };
  }
}

async function resolveOfficialWgtUrl() {
  try {
    const headers = {
      Accept: "application/vnd.github+json",
      "User-Agent": "NuvioXbox-BuildHydrator"
    };
    if (process.env.GITHUB_TOKEN) {
      headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
    }
    const response = await fetch(LATEST_RELEASE_API, {
      headers,
      signal: AbortSignal.timeout(15000)
    });
    if (response.ok) {
      const release = await response.json();
      const assets = Array.isArray(release?.assets) ? release.assets : [];
      const wgtAsset = assets.find((asset) =>
        /^NuvioTV-Tizen-.*\.wgt$/i.test(String(asset?.name || ""))
      );
      if (wgtAsset?.browser_download_url) {
        return String(wgtAsset.browser_download_url);
      }
    }
  } catch {
    // Fall back to known release package URL when GitHub API is rate-limited.
  }
  return FALLBACK_WGT_URL;
}

async function downloadWgtToCache(url) {
  await mkdir(cacheDir, { recursive: true });
  const response = await fetch(url, {
    headers: { "User-Agent": "NuvioXbox-BuildHydrator" },
    signal: AbortSignal.timeout(60000)
  });
  if (!response.ok) {
    throw new Error(`Failed to download official NuvioTVSmart release package (HTTP ${response.status})`);
  }
  const arrayBuffer = await response.arrayBuffer();
  await writeFile(cachedWgtPath, Buffer.from(arrayBuffer));
}

async function extractEnvFromWgt(wgtPath) {
  const archiveBytes = await readFile(wgtPath);
  const zip = await JSZip.loadAsync(archiveBytes);
  const entry =
    zip.file("nuvio.env.js") ||
    zip.file("js/runtime/env.js") ||
    Object.values(zip.files).find((item) => !item.dir && item.name.endsWith("nuvio.env.js"));
  if (!entry) {
    throw new Error("Official release package did not contain nuvio.env.js");
  }
  return entry.async("string");
}

export async function hydrateOfficialEnv({ force = false } = {}) {
  await mkdir(distDir, { recursive: true });

  if (!force && (await fileReadable(targetEnvPath))) {
    const existing = await readFile(targetEnvPath, "utf8");
    const check = inspectEnvScript(existing);
    if (check.valid) {
      console.log("nuvio.env.js already contains configured runtime endpoints.");
      return { source: "existing-dist", ...check };
    }
  }

  let wgtScript = "";
  if (await fileReadable(cachedWgtPath)) {
    try {
      wgtScript = await extractEnvFromWgt(cachedWgtPath);
    } catch {
      wgtScript = "";
    }
  }

  if (!inspectEnvScript(wgtScript).valid) {
    const downloadUrl = await resolveOfficialWgtUrl();
    console.log("Fetching official Nuvio runtime config from latest release package...");
    await downloadWgtToCache(downloadUrl);
    wgtScript = await extractEnvFromWgt(cachedWgtPath);
  }

  const check = inspectEnvScript(wgtScript);
  if (!check.valid) {
    throw new Error("Extracted nuvio.env.js failed runtime endpoint validation.");
  }

  await writeFile(targetEnvPath, wgtScript, "utf8");
  console.log("Hydrated dist/nuvio.env.js from official NuvioTVSmart release (values redacted).");
  return { source: "official-wgt", ...check };
}

const isMain =
  process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMain) {
  hydrateOfficialEnv({ force: process.argv.includes("--force") }).catch((error) => {
    console.error("Failed to hydrate official env:", error?.message || error);
    process.exit(1);
  });
}
