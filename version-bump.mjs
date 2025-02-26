import { readFileSync, writeFileSync } from "fs";

const targetVersion = process.env.npm_package_version;

// 매니페스트 업데이트
let manifest = JSON.parse(readFileSync("manifest.json", "utf8"));
manifest.version = targetVersion;
writeFileSync("manifest.json", JSON.stringify(manifest, null, 2));

// 버전 파일 업데이트
let versions = JSON.parse(readFileSync("versions.json", "utf8"));
versions[targetVersion] = manifest.minAppVersion;
writeFileSync("versions.json", JSON.stringify(versions, null, 2));

console.log(`Version bump to ${targetVersion}`);
