import { access, cp, mkdir, rm, writeFile } from "node:fs/promises";
import { constants as fsConstants } from "node:fs";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import zlib from "node:zlib";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");
const distDir = path.join(rootDir, "dist");
const uwpProjectDir = path.join(rootDir, "xbox-uwp", "NuvioXbox");
const webCodeDir = path.join(uwpProjectDir, "WebCode");
const assetsOutDir = path.join(uwpProjectDir, "Assets");

export const REQUIRED_UWP_ASSETS = [
  { file: "StoreLogo.png", width: 50, height: 50, source: "mark" },
  { file: "Square44x44Logo.scale-200.png", width: 88, height: 88, source: "mark" },
  { file: "Square44x44Logo.targetsize-24_altform-unplated.png", width: 24, height: 24, source: "mark" },
  { file: "Square150x150Logo.scale-200.png", width: 300, height: 300, source: "mark" },
  { file: "Wide310x150Logo.scale-200.png", width: 620, height: 300, source: "wordmark" },
  { file: "SplashScreen.scale-200.png", width: 1240, height: 600, source: "wordmark" },
  { file: "LockScreenLogo.scale-200.png", width: 48, height: 48, source: "mark" }
];

async function pathExists(targetPath) {
  try {
    await access(targetPath, fsConstants.R_OK);
    return true;
  } catch {
    return false;
  }
}

function crc32(buffer) {
  let crc = 0xffffffff;
  for (let i = 0; i < buffer.length; i += 1) {
    crc ^= buffer[i];
    for (let j = 0; j < 8; j += 1) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function makePngChunk(type, data) {
  const typeBuf = Buffer.from(type, "ascii");
  const lenBuf = Buffer.alloc(4);
  lenBuf.writeUInt32BE(data.length, 0);
  const crcBuf = Buffer.alloc(4);
  const crcVal = crc32(Buffer.concat([typeBuf, data]));
  crcBuf.writeUInt32BE(crcVal, 0);
  return Buffer.concat([lenBuf, typeBuf, data, crcBuf]);
}

function createSolidFallbackPng(width, height) {
  const rowSize = 1 + width * 4;
  const raw = Buffer.alloc(rowSize * height);
  for (let y = 0; y < height; y += 1) {
    const rowOffset = y * rowSize;
    raw[rowOffset] = 0;
    for (let x = 0; x < width; x += 1) {
      const px = rowOffset + 1 + x * 4;
      const inCenterBadge =
        Math.abs(x - width / 2) < width * 0.25 && Math.abs(y - height / 2) < height * 0.25;
      raw[px] = inCenterBadge ? 245 : 13;
      raw[px + 1] = inCenterBadge ? 245 : 13;
      raw[px + 2] = inCenterBadge ? 245 : 13;
      raw[px + 3] = 255;
    }
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  const idat = zlib.deflateSync(raw);
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  return Buffer.concat([
    signature,
    makePngChunk("IHDR", ihdr),
    makePngChunk("IDAT", idat),
    makePngChunk("IEND", Buffer.alloc(0))
  ]);
}

function tryGenerateAssetsWithSips(markPath, wordmarkPath) {
  if (process.platform !== "darwin") {
    return false;
  }
  try {
    for (const item of REQUIRED_UWP_ASSETS) {
      const outPath = path.join(assetsOutDir, item.file);
      const srcPath = item.source === "wordmark" ? wordmarkPath : markPath;
      const maxLogoWidth = Math.max(12, Math.round(item.width * 0.72));
      const maxLogoHeight = Math.max(12, Math.round(item.height * 0.72));
      const tempScaled = path.join(assetsOutDir, `.tmp-${item.file}`);
      execFileSync("sips", ["-Z", String(Math.min(maxLogoWidth, maxLogoHeight)), srcPath, "--out", tempScaled], {
        stdio: "ignore"
      });
      execFileSync(
        "sips",
        [
          "--padToHeightWidth",
          String(item.height),
          String(item.width),
          "--padColor",
          "0D0D0D",
          tempScaled,
          "--out",
          outPath
        ],
        { stdio: "ignore" }
      );
      execFileSync("rm", ["-f", tempScaled], { stdio: "ignore" });
    }
    return true;
  } catch {
    return false;
  }
}

async function ensureUwpAssets({ refresh = false } = {}) {
  await mkdir(assetsOutDir, { recursive: true });
  const missing = [];
  for (const item of REQUIRED_UWP_ASSETS) {
    if (refresh || !(await pathExists(path.join(assetsOutDir, item.file)))) {
      missing.push(item);
    }
  }
  if (!missing.length) {
    return;
  }

  const markPath = path.join(rootDir, "assets", "brand", "app_logo_mark.png");
  const wordmarkPath = path.join(rootDir, "assets", "brand", "app_logo_wordmark.png");
  if ((await pathExists(markPath)) && (await pathExists(wordmarkPath))) {
    if (tryGenerateAssetsWithSips(markPath, wordmarkPath)) {
      console.log("Generated UWP branding assets from app_logo_mark/wordmark.");
      return;
    }
  }

  for (const item of missing) {
    const pngBuffer = createSolidFallbackPng(item.width, item.height);
    await writeFile(path.join(assetsOutDir, item.file), pngBuffer);
  }
  console.log("Generated fallback UWP branding assets.");
}

export async function stageXboxWebCode({ refreshAssets = false } = {}) {
  const requiredDistFiles = ["index.html", "app.bundle.js", "nuvio.env.js"];
  for (const relPath of requiredDistFiles) {
    if (!(await pathExists(path.join(distDir, relPath)))) {
      throw new Error(`Missing required build output: dist/${relPath}. Run build & hydrate:env first.`);
    }
  }

  await rm(webCodeDir, { recursive: true, force: true });
  await mkdir(webCodeDir, { recursive: true });
  await cp(distDir, webCodeDir, { recursive: true });
  await ensureUwpAssets({ refresh: refreshAssets });
  console.log(`Staged WebCode into ${webCodeDir}`);
}

const isMain =
  process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMain) {
  stageXboxWebCode({ refreshAssets: process.argv.includes("--refresh-assets") }).catch((error) => {
    console.error("Failed to stage Xbox WebCode:", error?.message || error);
    process.exit(1);
  });
}
