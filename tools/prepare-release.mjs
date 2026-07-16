import { readFile, writeFile } from "node:fs/promises";
import process from "node:process";

const version = process.argv[2]?.replace(/^v/, "");
const semver = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;

if (!version || !semver.test(version)) {
    console.error("Usage: node tools/prepare-release.mjs <major.minor.patch>");
    process.exit(1);
}

const manifestPath = new URL("../module.json", import.meta.url);
const manifest = JSON.parse(await readFile(manifestPath, "utf8"));

manifest.version = version;
manifest.download = `https://github.com/AT0M1X/hero-points/releases/download/v${version}/hero-points.zip`;

await writeFile(manifestPath, `${JSON.stringify(manifest, null, 4)}\n`, "utf8");
console.log(`Prepared module.json for v${version}.`);
