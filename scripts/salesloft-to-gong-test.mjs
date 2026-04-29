#!/usr/bin/env node
// Test run: pull N recent Salesloft conversations and import each into Gong.
// Reads creds from .env.local. Uses ben.mcwilliams@2x.marketing as primaryUser
// override (id 8307839589829552536) unless overridden via --primary-user-id.
//
// Usage:
//   node scripts/salesloft-to-gong-test.mjs                    # 5 most recent
//   node scripts/salesloft-to-gong-test.mjs --limit 1          # just one
//   node scripts/salesloft-to-gong-test.mjs --primary-user-id 8307839589829552536

import fs from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";

// --- Load .env.local ----------------------------------------------------
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
if (!SLK || !GAK || !GAS) {
  console.error("Need SALESLOFT_API_KEY, GONG_ACCESS_KEY, GONG_ACCESS_KEY_SECRET in .env.local");
  process.exit(1);
}
const slHeaders = { Authorization: `Bearer ${SLK}`, Accept: "application/json" };
const gongAuth = "Basic " + Buffer.from(`${GAK}:${GAS}`).toString("base64");
const gongHeaders = { Authorization: gongAuth, "Content-Type": "application/json" };

// --- Args ---------------------------------------------------------------
const args = process.argv.slice(2);
const arg = (f, d) => {
  const i = args.indexOf(f);
  return i >= 0 ? args[i + 1] : d;
};
const limit = Number(arg("--limit", "5"));
const primaryUserId = arg("--primary-user-id", "8307839589829552536"); // Ben McWilliams

// --- Helpers ------------------------------------------------------------
async function slGet(p) {
  const r = await fetch(`https://api.salesloft.com${p}`, { headers: slHeaders });
  if (!r.ok) throw new Error(`Salesloft ${p} → ${r.status} ${await r.text()}`);
  return r.json();
}
async function slGetRedirect(p) {
  const r = await fetch(`https://api.salesloft.com${p}`, { headers: slHeaders, redirect: "manual" });
  if (r.status >= 300 && r.status < 400) {
    const loc = r.headers.get("location");
    if (loc) return { url: loc };
  }
  if (!r.ok) throw new Error(`Salesloft ${p} → ${r.status} ${await r.text()}`);
  const j = await r.json();
  const url = j.data?.url || j.data?.recording_url || j.url || j.recording_url;
  if (!url) throw new Error(`Salesloft ${p} → no recording URL in response`);
  return { url };
}

// Sniff actual format from the bytes (URLs lie — Salesloft signs audio-only
// MP4s with .mp4 extension, but Gong rejects video/mp4 if no video stream).
function detectContentType(buf) {
  if (buf.length < 12) return "application/octet-stream";
  const m = buf.subarray(0, 12);
  if (m.subarray(4, 8).toString("ascii") === "ftyp") {
    // Salesloft recordings are audio-only AAC in an MP4 container. Gong's
    // PUT /v2/calls/:id/media rejects both "video/mp4" (no video track) and
    // "audio/mp4" (415). Falling through to octet-stream lets Gong sniff.
    return "application/octet-stream";
  }
  if (m[0] === 0x1a && m[1] === 0x45 && m[2] === 0xdf && m[3] === 0xa3) return "video/x-matroska";
  if (m[0] === 0x49 && m[1] === 0x44 && m[2] === 0x33) return "audio/mpeg";
  if (m[0] === 0xff && (m[1] & 0xe0) === 0xe0) return "audio/mpeg";
  if (m.subarray(0, 4).toString("ascii") === "RIFF" && m.subarray(8, 12).toString("ascii") === "WAVE") return "audio/wav";
  if (m.subarray(0, 4).toString("ascii") === "fLaC") return "audio/flac";
  return "application/octet-stream";
}

// Transcode an in-memory buffer to MP3 via ffmpeg (stdin → stdout pipe).
// Salesloft serves audio-only AAC-in-MP4 which Gong's /v2/calls/:id/media
// rejects. Re-encoding to MP3 sidesteps the format check entirely.
function transcodeToMp3(input) {
  return new Promise((resolve, reject) => {
    const proc = spawn("ffmpeg", [
      "-loglevel", "error",
      "-i", "pipe:0",
      "-vn",                 // strip any video track if present
      "-acodec", "libmp3lame",
      "-ab", "128k",         // 128 kbps mono is plenty for speech
      "-ar", "44100",
      "-f", "mp3",
      "pipe:1",
    ]);
    const chunks = [];
    let stderr = "";
    proc.stdout.on("data", (c) => chunks.push(c));
    proc.stderr.on("data", (c) => (stderr += c.toString()));
    proc.on("error", reject);
    proc.on("close", (code) => {
      if (code !== 0) return reject(new Error(`ffmpeg exited ${code}: ${stderr}`));
      resolve(Buffer.concat(chunks));
    });
    proc.stdin.write(input);
    proc.stdin.end();
  });
}

async function gongCreateCall(metadata) {
  const r = await fetch(`${GBASE}/v2/calls`, {
    method: "POST",
    headers: gongHeaders,
    body: JSON.stringify(metadata),
  });
  const body = await r.text();
  if (!r.ok) {
    // Idempotent path: if the call already exists for this clientUniqueId, Gong
    // returns 400 with the existing callId in the error message. Reuse it so
    // we can retry the media upload.
    if (r.status === 400 && body.includes("has already been posted for the call")) {
      const m = body.match(/posted for the call (\d+)/);
      if (m) return { callId: m[1], reused: true };
    }
    throw new Error(`POST /v2/calls → ${r.status} ${body}`);
  }
  const j = JSON.parse(body);
  return { callId: j.callId || j.callIds?.[0] || j.id, reused: false };
}

async function gongUploadMedia(callId, buffer, contentType, filename) {
  // Gong's /v2/calls/{id}/media expects multipart/form-data with a `mediaFile`
  // field — not a raw PUT body. Sending raw bytes returns 415 even with the
  // correct Content-Type. Documented at:
  // https://help.gong.io/docs/uploading-calls-from-a-non-integrated-telephony-system
  const form = new FormData();
  form.append("mediaFile", new Blob([buffer], { type: contentType }), filename);
  const r = await fetch(`${GBASE}/v2/calls/${encodeURIComponent(callId)}/media`, {
    method: "PUT",
    headers: { Authorization: gongAuth }, // let fetch set multipart boundary
    body: form,
  });
  if (!r.ok) {
    const body = await r.text();
    throw new Error(`PUT /v2/calls/${callId}/media → ${r.status} ${body}`);
  }
  return r.json().catch(() => ({}));
}

// --- Run ----------------------------------------------------------------
console.log(`Fetching ${limit} most recent Salesloft conversations...`);
const list = await slGet(`/v2/conversations?per_page=${limit}&page=1&sort_by=created_at&sort_direction=desc`);
const calls = list.data || [];
console.log(`Found ${calls.length} conversations to import.\n`);

const results = [];
let idx = 0;
for (const c of calls) {
  idx++;
  const tag = `[${idx}/${calls.length}]`;
  console.log(`${tag} ${c.id}  "${c.title || "(no title)"}"`);
  try {
    // 1. Get a signed recording URL
    const { url: recUrl } = await slGetRedirect(`/v2/conversations/${c.id}/recording`);

    // 2. Pull the bytes
    console.log(`${tag}   downloading recording...`);
    const dlStart = Date.now();
    const dl = await fetch(recUrl);
    if (!dl.ok) throw new Error(`recording download → ${dl.status}`);
    const rawBuf = Buffer.from(await dl.arrayBuffer());
    const rawType = detectContentType(rawBuf);
    console.log(`${tag}   downloaded ${(rawBuf.length / 1024 / 1024).toFixed(2)} MB raw (${rawType})`);

    // Transcode to MP3 — Gong rejects AAC-in-MP4 (audio-only) regardless of
    // the Content-Type header. MP3 is universally accepted.
    let buf = rawBuf;
    let contentType = rawType;
    if (rawType !== "audio/mpeg" && rawType !== "audio/wav" && rawType !== "audio/flac") {
      console.log(`${tag}   transcoding to MP3 with ffmpeg...`);
      const tStart = Date.now();
      buf = await transcodeToMp3(rawBuf);
      contentType = "audio/mpeg";
      console.log(`${tag}   transcoded → ${(buf.length / 1024 / 1024).toFixed(2)} MB in ${((Date.now() - tStart) / 1000).toFixed(1)}s`);
    }
    void dlStart; // (already logged above)

    // 3. Build Gong metadata. primaryUser is the override (Ben).
    //    Other fields: title, started time, parties (best-effort), client uniq id (Salesloft id).
    // Salesloft is inconsistent: started_recording_at comes back as epoch
    // seconds for some rows (1731701501) and epoch milliseconds for others
    // (1666713630000). Discriminate by magnitude — anything < 1e11 must be
    // seconds (1e11 ms is year 1973; smaller values can't be sensible ms).
    const startRaw = c.started_recording_at ?? c.event_start_date ?? c.created_at;
    const startedDate =
      typeof startRaw === "number"
        ? new Date(startRaw < 1e11 ? startRaw * 1000 : startRaw)
        : new Date(startRaw ?? Date.now());
    const started = startedDate.toISOString();
    const durationMs = typeof c.duration === "number" ? c.duration : 0;
    const durationSec = Math.max(1, Math.round(durationMs / 1000));
    const parties = [
      {
        userId: primaryUserId,
        affiliation: "Internal",
      },
    ];
    const metadata = {
      clientUniqueId: `salesloft-${c.id}-${Date.now()}`,
      title: c.title || `Salesloft call ${c.id}`,
      actualStart: new Date(started).toISOString(),
      duration: durationSec,
      direction: "Conference",
      primaryUser: primaryUserId,
      parties,
      // Optional: language
      ...(c.language_code && { languageCode: c.language_code }),
    };

    // 4. Create (or reuse, if previously created) the Gong call.
    console.log(`${tag}   creating Gong call...`);
    const { callId, reused } = await gongCreateCall(metadata);
    console.log(`${tag}   ${reused ? "reusing existing" : "created"} Gong callId=${callId}`);

    // 5. Upload media bytes
    console.log(`${tag}   uploading media to Gong...`);
    const upStart = Date.now();
    const ext = contentType === "audio/mpeg" ? "mp3" : contentType === "audio/wav" ? "wav" : contentType === "audio/flac" ? "flac" : "bin";
    await gongUploadMedia(callId, buf, contentType, `recording.${ext}`);
    console.log(`${tag}   uploaded in ${((Date.now() - upStart) / 1000).toFixed(1)}s ✓`);

    results.push({
      salesloftId: c.id,
      title: c.title,
      gongCallId: callId,
      status: "ok",
      sizeMB: +(buf.length / 1024 / 1024).toFixed(2),
    });
  } catch (err) {
    console.log(`${tag}   ✗ ERROR: ${err.message}`);
    results.push({
      salesloftId: c.id,
      title: c.title,
      status: "error",
      error: err.message,
    });
  }
  console.log("");
}

console.log("=== Summary ===");
const ok = results.filter((r) => r.status === "ok");
const fail = results.filter((r) => r.status === "error");
console.log(`Imported: ${ok.length}/${results.length}`);
if (ok.length) {
  for (const r of ok) {
    console.log(`  ✓ ${r.salesloftId} → Gong ${r.gongCallId}  (${r.sizeMB} MB)  "${r.title}"`);
  }
}
if (fail.length) {
  console.log("");
  console.log("Failed:");
  for (const r of fail) {
    console.log(`  ✗ ${r.salesloftId}  "${r.title}"`);
    console.log(`      ${r.error}`);
  }
}

await fs.writeFile(
  path.resolve("./scripts/salesloft-to-gong-test-result.json"),
  JSON.stringify({ generatedAt: new Date().toISOString(), primaryUserId, results }, null, 2)
);
console.log("");
console.log("Detailed JSON: scripts/salesloft-to-gong-test-result.json");
