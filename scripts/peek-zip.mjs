#!/usr/bin/env node
import fs from "node:fs/promises";
import JSZip from "jszip";

const zipPath = process.argv[2];
const buf = await fs.readFile(zipPath);
const zip = await JSZip.loadAsync(buf);

console.log("Total entries:", Object.keys(zip.files).length);
console.log("");

// Show first 20 entry names
const names = Object.keys(zip.files);
console.log("First 30 entries:");
names.slice(0, 30).forEach((n) => console.log("  " + n));
console.log("");

// Find anything that looks like manifest or metadata
const interesting = names.filter((n) =>
  /metadata|manifest|user|call/i.test(n) && n.toLowerCase().endsWith(".json")
);
console.log("JSON entries (metadata/manifest/user/call):");
interesting.slice(0, 20).forEach((n) => console.log("  " + n));
console.log("");

// Show contents of first metadata.json or manifest.json
const firstMeta = names.find((n) => /metadata\.json$/i.test(n));
const firstManifest = names.find((n) => /manifest\.json$/i.test(n));

if (firstMeta) {
  console.log(`=== ${firstMeta} (top keys + sample) ===`);
  const txt = await zip.files[firstMeta].async("string");
  try {
    const obj = JSON.parse(txt);
    console.log("Top-level keys:", Object.keys(obj));
    console.log(JSON.stringify(obj, null, 2).slice(0, 3000));
  } catch (e) {
    console.log("(not valid JSON)", txt.slice(0, 500));
  }
  console.log("");
}

if (firstManifest) {
  console.log(`=== ${firstManifest} (top keys + sample) ===`);
  const txt = await zip.files[firstManifest].async("string");
  try {
    const obj = JSON.parse(txt);
    console.log("Top-level keys:", Object.keys(obj));
    if (Array.isArray(obj)) {
      console.log("Array length:", obj.length);
      console.log("First entry:", JSON.stringify(obj[0], null, 2));
    } else {
      console.log(JSON.stringify(obj, null, 2).slice(0, 3000));
    }
  } catch (e) {
    console.log("(not valid JSON)", txt.slice(0, 500));
  }
}
