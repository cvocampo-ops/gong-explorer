#!/usr/bin/env node
// Probe: does Gong's media upload accept Salesloft's audio-only MP4 bytes
// when sent via multipart/form-data with various content-types?
//
// We create a fresh call per attempt (with a unique clientUniqueId), download
// the same Salesloft recording, and PUT to /v2/calls/:id/media with each
// candidate content-type. Whichever succeeds tells us the cheapest in-app
// path for Salesloft → Gong.

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
const GAK = process.env.GONG_ACCESS_KEY;
const GAS = process.env.GONG_ACCESS_KEY_SECRET;
const GBASE = (process.env.GONG_BASE_URL || "https://api.gong.io").replace(/\/+$/, "");
const slHeaders = { Authorization: `Bearer ${SLK}`, Accept: "application/json" };
const gongAuth = "Basic " + Buffer.from(`${GAK}:${GAS}`).toString("base64");
const PRIMARY_USER_ID = "8307839589829552536"; // Ben

// Pick an old Salesloft conversation (oldest first) — far less likely to
// duplicate something Gong already has natively, so any 400 response will
// be a real format rejection rather than the content-dedup error.
const list = await (await fetch("https://api.salesloft.com/v2/conversations?per_page=1&page=1&sort_by=created_at&sort_direction=asc", { headers: slHeaders })).json();
const conv = list.data[0];
console.log(`Using SL conv ${conv.id} "${conv.title}"`);

// Get signed URL + bytes
const recResp = await fetch(`https://api.salesloft.com/v2/conversations/${conv.id}/recording`, { headers: slHeaders, redirect: "manual" });
let recUrl;
if (recResp.status >= 300 && recResp.status < 400) recUrl = recResp.headers.get("location");
else recUrl = (await recResp.json()).data?.url;
const dl = await fetch(recUrl);
const buf = Buffer.from(await dl.arrayBuffer());
console.log(`Downloaded ${(buf.length / 1024 / 1024).toFixed(2)} MB AAC-in-MP4 bytes\n`);

const startRaw = conv.started_recording_at ?? conv.event_start_date ?? conv.created_at;
const started = (
  typeof startRaw === "number"
    ? new Date(startRaw < 1e11 ? startRaw * 1000 : startRaw)
    : new Date(startRaw)
).toISOString();

const candidates = [
  { ct: "audio/mp4", filename: "recording.m4a" },
  { ct: "audio/x-m4a", filename: "recording.m4a" },
  { ct: "video/mp4", filename: "recording.mp4" },
  { ct: "audio/aac", filename: "recording.aac" },
  { ct: "application/octet-stream", filename: "recording.mp4" },
];

const results = [];
for (const { ct, filename } of candidates) {
  console.log(`Trying ${ct} (${filename})...`);

  // Fresh call per attempt
  const meta = {
    clientUniqueId: `probe-mp4-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    title: `[probe ${ct}] ${conv.title}`,
    actualStart: started,
    direction: "Conference",
    primaryUser: PRIMARY_USER_ID,
    parties: [{ userId: PRIMARY_USER_ID, affiliation: "Internal" }],
  };
  const cr = await fetch(`${GBASE}/v2/calls`, {
    method: "POST",
    headers: { Authorization: gongAuth, "Content-Type": "application/json" },
    body: JSON.stringify(meta),
  });
  if (!cr.ok) {
    console.log(`  create call → ${cr.status} ${await cr.text()}`);
    continue;
  }
  const callId = (await cr.json()).callId;
  console.log(`  callId: ${callId}`);

  const form = new FormData();
  form.append("mediaFile", new Blob([buf], { type: ct }), filename);
  const ur = await fetch(`${GBASE}/v2/calls/${callId}/media`, {
    method: "PUT",
    headers: { Authorization: gongAuth },
    body: form,
  });
  const upBody = await ur.text();
  const ok = ur.ok;
  console.log(`  upload  → ${ur.status} ${ok ? "OK" : "FAIL"}`);
  if (!ok) console.log(`           ${upBody.slice(0, 200)}`);
  console.log("");
  results.push({ ct, filename, ok, status: ur.status, callId, body: ok ? null : upBody });
}

console.log("=== Summary ===");
for (const r of results) {
  const tag = r.ok ? "✓" : "✗";
  console.log(`  ${tag}  ${r.ct.padEnd(28)} ${r.filename.padEnd(16)} HTTP ${r.status}  call ${r.callId}`);
}
const winner = results.find((r) => r.ok);
if (winner) {
  console.log("");
  console.log(`First working content-type: ${winner.ct}`);
  console.log(`→ Option 1 (in-app, no transcoding) is viable.`);
} else {
  console.log("");
  console.log(`No content-type accepted raw AAC-in-MP4 bytes.`);
  console.log(`→ Need Option 2 (server-side transcoding to MP3) for in-app Salesloft → Gong.`);
}
