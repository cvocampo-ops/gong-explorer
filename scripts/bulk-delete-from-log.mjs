#!/usr/bin/env node
// Bulk-delete Gong calls listed in scripts/salesloft-bulk.jsonl.
//
// Use this when you want to clear out a prior bulk import (e.g. before
// re-running with corrected ownership). It walks every status=ok and
// status=dedup row in the JSONL log and DELETEs each Gong callId
// (including dedupCallIds for status=dedup rows, since those point to
// the call that actually has the audio).
//
// Behavior:
//   1. Reads salesloft-bulk.jsonl from cwd
//   2. Collects unique callIds (callId + dedupCallId from ok/dedup rows)
//   3. Probes DELETE /v2/calls/{id} on the FIRST callId to confirm the
//      endpoint exists and is permissioned. Aborts if it returns 404/405.
//   4. Deletes the rest with retry on 429/5xx
//   5. Writes per-call results to scripts/bulk-delete.jsonl
//
// Usage:
//   node scripts/bulk-delete-from-log.mjs --dry-run                # preview only, no DELETEs
//   node scripts/bulk-delete-from-log.mjs --limit 5                # delete first 5 (smoke test)
//   node scripts/bulk-delete-from-log.mjs                          # full purge
//   node scripts/bulk-delete-from-log.mjs --log scripts/other.jsonl  # use a different source log

import fs from "node:fs/promises";
import { createWriteStream, existsSync, readFileSync } from "node:fs";
import path from "node:path";

const envText = await fs.readFile(path.resolve("./.env.local"), "utf8");
for (const line of envText.split("\n")) {
  const m = line.match(/^([A-Z_]+)=(.*)$/);
  if (!m) continue;
  let v = m[2];
  if (v.startsWith('"') && v.endsWith('"')) v = v.slice(1, -1);
  if (!process.env[m[1]]) process.env[m[1]] = v;
}

const GAK = process.env.GONG_ACCESS_KEY;
const GAS = process.env.GONG_ACCESS_KEY_SECRET;
const GBASE = (process.env.GONG_BASE_URL || "https://api.gong.io").replace(/\/+$/, "");
const gAuth = "Basic " + Buffer.from(`${GAK}:${GAS}`).toString("base64");

const args = process.argv.slice(2);
const arg = (f, d) => { const i = args.indexOf(f); return i >= 0 ? args[i + 1] : d; };
const flag = (f) => args.includes(f);

const LOG_PATH = path.resolve(arg("--log", "./scripts/salesloft-bulk.jsonl"));
const DELETE_LOG_PATH = path.resolve("./scripts/bulk-delete.jsonl");
const dryRun = flag("--dry-run");
const limit = arg("--limit") ? Number(arg("--limit")) : null;

if (!existsSync(LOG_PATH)) {
  console.error(`Log file not found: ${LOG_PATH}`);
  process.exit(1);
}

// --- Build unique target list from log ---
const targets = new Set(); // unique callIds to delete
const seen = new Map();     // callId → first row source (for traceability)
for (const line of readFileSync(LOG_PATH, "utf8").split("\n")) {
  if (!line.trim()) continue;
  let e;
  try { e = JSON.parse(line); } catch { continue; }
  if (e.status !== "ok" && e.status !== "dedup") continue;
  if (e.callId && !targets.has(e.callId)) {
    targets.add(e.callId);
    seen.set(e.callId, { slId: e.slId, title: e.title, role: "callId" });
  }
  if (e.dedupCallId && !targets.has(e.dedupCallId)) {
    targets.add(e.dedupCallId);
    seen.set(e.dedupCallId, { slId: e.slId, title: e.title, role: "dedupCallId" });
  }
}

let list = Array.from(targets);
if (limit) list = list.slice(0, limit);

console.log(`Source log:    ${path.relative(process.cwd(), LOG_PATH)}`);
console.log(`Targets:       ${list.length} unique callIds`);
console.log(`Tenant:        ${GBASE}`);
console.log(`Mode:          ${dryRun ? "DRY RUN (no DELETEs)" : "LIVE DELETE"}`);
console.log(`Delete log:    ${dryRun ? "(none — dry run)" : path.relative(process.cwd(), DELETE_LOG_PATH)}`);
console.log("");

if (dryRun) {
  for (const callId of list.slice(0, 20)) {
    const src = seen.get(callId);
    console.log(`  would DELETE ${callId}  (slId=${src.slId} role=${src.role})  "${(src.title||"").slice(0,60)}"`);
  }
  if (list.length > 20) console.log(`  ... and ${list.length - 20} more`);
  console.log(`\nDry run complete. Re-run without --dry-run to execute.`);
  process.exit(0);
}

// --- API helpers ---
async function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }
async function deleteCall(callId) {
  const MAX = 5;
  for (let attempt = 0; attempt < MAX; attempt++) {
    try {
      const r = await fetch(`${GBASE}/v2/calls/${encodeURIComponent(callId)}`, {
        method: "DELETE",
        headers: { Authorization: gAuth },
      });
      if (r.status === 429) {
        const wait = Number(r.headers.get("retry-after") || 5);
        console.log(`        ${callId}: 429 — sleeping ${wait}s (attempt ${attempt + 1}/${MAX})`);
        await sleep(wait * 1000);
        continue;
      }
      if (r.status >= 500 && r.status < 600) {
        const wait = Math.min(60, 2 ** (attempt + 2));
        console.log(`        ${callId}: ${r.status} — backoff ${wait}s (attempt ${attempt + 1}/${MAX})`);
        await sleep(wait * 1000);
        continue;
      }
      return { status: r.status, body: await r.text() };
    } catch (err) {
      const wait = Math.min(60, 2 ** (attempt + 2));
      console.log(`        ${callId}: ${err.message} — backoff ${wait}s`);
      await sleep(wait * 1000);
    }
  }
  return { status: -1, body: "retries exhausted" };
}

// --- Probe: confirm DELETE endpoint exists before going bulk ---
const probeCallId = list[0];
console.log(`Probing DELETE /v2/calls/${probeCallId} ...`);
const probe = await deleteCall(probeCallId);
console.log(`  → ${probe.status} ${probe.body.slice(0, 200)}`);
if (probe.status === 404 || probe.status === 405) {
  console.log(`\n✗ DELETE endpoint is not available (${probe.status}). Aborting.`);
  console.log(`  Falling back to manual UI deletion is required.`);
  console.log(`  Probed callId ${probeCallId} was not modified.`);
  process.exit(2);
}
if (probe.status < 200 || probe.status >= 300) {
  // Some 4xx codes are interesting — e.g. 403 forbidden, 401 unauthorized.
  // 200/204 = deleted. 404 = already gone (acceptable, treat as success).
  if (probe.status === 404) {
    console.log(`  callId ${probeCallId} was already deleted (404). Continuing.`);
  } else {
    console.log(`\n✗ Probe returned ${probe.status} — investigate before bulk delete.`);
    process.exit(3);
  }
}
console.log(`✓ DELETE works. Proceeding with bulk.\n`);

const deleteStream = createWriteStream(DELETE_LOG_PATH, { flags: "a" });
function logEvent(event) { deleteStream.write(JSON.stringify({ t: new Date().toISOString(), ...event }) + "\n"); }

// Record the probe result
{
  const src = seen.get(probeCallId);
  logEvent({ callId: probeCallId, slId: src.slId, role: src.role, status: probe.status, body: probe.body.slice(0, 200) });
}

const stats = { ok: 0, alreadyGone: 0, error: 0 };
const startedAt = Date.now();

for (let i = 1; i < list.length; i++) {
  const callId = list[i];
  const src = seen.get(callId);
  const tag = `[${i + 1}/${list.length}]`;
  const result = await deleteCall(callId);
  const ok = result.status >= 200 && result.status < 300;
  const gone = result.status === 404;
  if (ok) { stats.ok++; console.log(`${tag} ✓ deleted ${callId}  (slId=${src.slId} ${src.role})`); }
  else if (gone) { stats.alreadyGone++; console.log(`${tag} ↺ ${callId} already gone (404)`); }
  else { stats.error++; console.log(`${tag} ✗ ${callId} → ${result.status} ${result.body.slice(0, 200)}`); }
  logEvent({ callId, slId: src.slId, role: src.role, status: result.status, body: result.body.slice(0, 200) });

  if ((i + 1) % 25 === 0 || i + 1 === list.length) {
    const min = ((Date.now() - startedAt) / 60000).toFixed(1);
    console.log(`──── progress: ${i + 1}/${list.length}  ok=${stats.ok}  gone=${stats.alreadyGone}  err=${stats.error}  elapsed=${min}min`);
  }
}

console.log("");
console.log("=== DONE ===");
console.log(`Total processed: ${list.length}`);
console.log(`  ✓ deleted:        ${stats.ok}`);
console.log(`  ↺ already gone:   ${stats.alreadyGone}`);
console.log(`  ✗ errors:         ${stats.error}`);
console.log("");
console.log(`Per-call delete log: ${path.relative(process.cwd(), DELETE_LOG_PATH)}`);
console.log(`Once verified clean, re-run salesloft-to-gong-bulk.mjs (without --resume) to repopulate with correct ownership.`);
deleteStream.end();
