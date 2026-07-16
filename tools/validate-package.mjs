import { access, readFile } from "node:fs/promises";
import process from "node:process";

const MODULE_ID = "hero-points";
const REPOSITORY = "AT0M1X/hero-points";
const manifestPath = new URL("../module.json", import.meta.url);

function fail(message) {
    console.error(`Validation failed: ${message}`);
    process.exitCode = 1;
}

let manifest;

try {
    manifest = JSON.parse(await readFile(manifestPath, "utf8"));
} catch (error) {
    console.error(`Validation failed: could not read module.json (${error.message})`);
    process.exit(1);
}

const requiredStrings = ["id", "title", "description", "version", "url", "manifest", "download"];
for (const field of requiredStrings) {
    if (typeof manifest[field] !== "string" || !manifest[field].trim()) {
        fail(`module.json field \"${field}\" must be a non-empty string.`);
    }
}

if (manifest.id !== MODULE_ID) {
    fail(`module id must be \"${MODULE_ID}\".`);
}

const semver = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;
if (!semver.test(manifest.version)) {
    fail(`version \"${manifest.version}\" is not a supported semantic version.`);
}

const expectedUrl = `https://github.com/${REPOSITORY}`;
const expectedManifest = `${expectedUrl}/releases/latest/download/module.json`;
const expectedDownload = `${expectedUrl}/releases/download/v${manifest.version}/${MODULE_ID}.zip`;

if (manifest.url !== expectedUrl) {
    fail(`url must be ${expectedUrl}.`);
}
if (manifest.manifest !== expectedManifest) {
    fail(`manifest must be ${expectedManifest}.`);
}
if (manifest.download !== expectedDownload) {
    fail(`download must be ${expectedDownload}.`);
}

const releaseTag = process.argv[2];
if (releaseTag && releaseTag !== `v${manifest.version}`) {
    fail(`tag \"${releaseTag}\" does not match manifest version \"${manifest.version}\".`);
}

const referencedAssets = [
    ...(Array.isArray(manifest.esmodules) ? manifest.esmodules : []),
    ...(Array.isArray(manifest.scripts) ? manifest.scripts : []),
    ...(Array.isArray(manifest.styles) ? manifest.styles : [])
];

for (const asset of referencedAssets) {
    try {
        await access(new URL(`../${asset}`, import.meta.url));
    } catch {
        fail(`referenced asset \"${asset}\" does not exist.`);
    }
}

if (!process.exitCode) {
    console.log(`Validated ${MODULE_ID} v${manifest.version}${releaseTag ? ` for tag ${releaseTag}` : ""}.`);
}
