import { readFileSync, writeFileSync } from "node:fs";

const targetVersion = process.env.npm_package_version;

// update manifest
const manifest = JSON.parse(readFileSync("manifest.json", "utf8"));
manifest.version = targetVersion;
writeFileSync("manifest.json", JSON.stringify(manifest, null, 2));

// update versions file
const versions = JSON.parse(readFileSync("versions.json", "utf8"));
versions[targetVersion] = manifest.minAppVersion;
writeFileSync("versions.json", JSON.stringify(versions, null, 2));

console.log(`Version bump to ${targetVersion}`);
