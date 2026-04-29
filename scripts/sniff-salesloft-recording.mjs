#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";

const envText = await fs.readFile(path.resolve("./.env.local"), "utf8");
for (const line of envText.split("\n")) {
  const m = line.match(/^([A-Z_]+)=(.*)$/);
  if (!m) continue;
  let v = m[2];
  if (v.startsWith('"') && v.endsWith('"')) v = v.slice(1, -1);
  if (!process.env[m[1]]) process.env[m[1]] = v;
}

const SLK = process.env.SALESLOFT_API_KEY;
const slHeaders = { Authorization: `Bearer ${SLK}`, Accept: "application/json" };

const list = await (await fetch("https://api.salesloft.com/v2/conversations?per_page=1&page=1&sort_by=created_at&sort_direction=desc", { headers: slHeaders })).json();
const c = list.data[0];
console.log(`conv id: ${c.id}, title: "${c.title}"`);

const r = await fetch(`https://api.salesloft.com/v2/conversations/${c.id}/recording`, { headers: slHeaders, redirect: "manual" });
let url;
if (r.status >= 300 && r.status < 400) url = r.headers.get("location");
else {
  const j = await r.json();
  url = j.data?.url || j.url;
}
console.log(`signed url: ${url?.slice(0, 120)}...`);

const dl = await fetch(url);
const ct = dl.headers.get("Content-Type");
const cl = dl.headers.get("Content-Length");
console.log(`Content-Type: ${ct}`);
console.log(`Content-Length: ${cl}`);
console.log(`Content-Disposition: ${dl.headers.get("Content-Disposition")}`);

const buf = Buffer.from(await dl.arrayBuffer());
console.log(`actual bytes: ${buf.length} (${(buf.length / 1024 / 1024).toFixed(2)} MB)`);
console.log(`first 32 bytes hex: ${buf.subarray(0, 32).toString("hex")}`);
console.log(`first 32 bytes ascii: ${buf.subarray(0, 32).toString("ascii").replace(/[^\x20-\x7e]/g, ".")}`);

// Magic byte sniffing
const magic = buf.subarray(0, 12);
let detected;
if (magic.subarray(4, 8).toString("ascii") === "ftyp") {
  const brand = magic.subarray(8, 12).toString("ascii");
  detected = `MP4/MOV (ftyp brand: ${brand})`;
} else if (magic[0] === 0x1a && magic[1] === 0x45 && magic[2] === 0xdf && magic[3] === 0xa3) {
  detected = "Matroska/WebM";
} else if (magic[0] === 0x49 && magic[1] === 0x44 && magic[2] === 0x33) {
  detected = "MP3 (ID3)";
} else if (magic[0] === 0xff && (magic[1] & 0xe0) === 0xe0) {
  detected = "MP3 (raw frame)";
} else if (magic.subarray(0, 4).toString("ascii") === "RIFF" && magic.subarray(8, 12).toString("ascii") === "WAVE") {
  detected = "WAV";
} else if (magic.subarray(0, 4).toString("ascii") === "fLaC") {
  detected = "FLAC";
} else if (magic.subarray(0, 4).toString("ascii") === "OggS") {
  detected = "Ogg";
} else {
  detected = "(unknown)";
}
console.log(`detected format: ${detected}`);

// Save the file so we can inspect with `file` and ffprobe
const outPath = path.resolve("/tmp/salesloft-sniff.bin");
await fs.writeFile(outPath, buf);
console.log(`saved to ${outPath}`);
