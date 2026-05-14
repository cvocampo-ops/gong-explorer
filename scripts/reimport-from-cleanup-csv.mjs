#!/usr/bin/env node
// Targeted re-import for the calls listed in scripts/cleanup-old-bens.csv.
//
// Use this AFTER you've deleted the OLD Ben-owned calls in Gong UI (the
// callIds in the CSV's first column). This script re-runs just those slIds
// — it doesn't touch the 154 already-correct imports.
//
// Flow:
//   1. Reads scripts/cleanup-old-bens.csv → extracts slIds
//   2. For each slId: pulls SL extensive, resolves rep, posts call + uploads media
//   3. Reports per-call status
//
// Usage:
//   node scripts/reimport-from-cleanup-csv.mjs --dry-run     # preview which slIds
//   node scripts/reimport-from-cleanup-csv.mjs --limit 5     # smoke-test 5 calls
//   node scripts/reimport-from-cleanup-csv.mjs               # full re-import

import fs from "node:fs/promises";
import { createWriteStream } from "node:fs";
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
const slH = { Authorization: `Bearer ${SLK}`, Accept: "application/json" };
const gAuth = "Basic " + Buffer.from(`${GAK}:${GAS}`).toString("base64");

const args = process.argv.slice(2);
const arg = (f, d) => { const i = args.indexOf(f); return i >= 0 ? args[i + 1] : d; };
const flag = (f) => args.includes(f);
const dryRun = flag("--dry-run");
const limit = arg("--limit") ? Number(arg("--limit")) : null;
const fallbackEmail = arg("--primary", "ben.mcwilliams@2x.marketing").toLowerCase();
// Suffix appended to clientUniqueId to bypass Gong's dedup on deleted calls.
// When Gong deletes a call via UI, the clientUniqueId→callId mapping persists
// at least for some time (hours, possibly indefinitely), so reusing the
// original `salesloft-{slId}` would just dedup back to the deleted Ben call.
// Defaulting to "v2" ensures every POST creates a fresh call shell with the
// correct primaryUser. Override per-run if you need to re-cycle (e.g. "v3").
const cuidSuffix = arg("--cuid-suffix", "v2");

const CSV_PATH = path.resolve("./scripts/cleanup-old-bens.csv");
const LOG_PATH = path.resolve("./scripts/reimport-cleanup.jsonl");

// --- Parse cleanup CSV → slIds ---
const csvText = await fs.readFile(CSV_PATH, "utf8");
const slIds = [];
for (const line of csvText.split("\n").slice(1)) {
  if (!line.trim()) continue;
  const parts = line.split(",");
  const slId = parts[1];
  if (slId && !slIds.includes(slId)) slIds.push(slId);
}
let target = slIds;
if (limit) target = target.slice(0, limit);
console.log(`Cleanup CSV:    ${path.relative(process.cwd(), CSV_PATH)}`);
console.log(`Total slIds:    ${slIds.length}`);
console.log(`To re-process:  ${target.length}${limit ? ` (--limit)` : ""}`);
console.log(`Mode:           ${dryRun ? "DRY RUN" : "LIVE"}`);
console.log(`Tenant:         ${GBASE}`);
console.log("");

if (dryRun) {
  for (const slId of target.slice(0, 15)) console.log(`  would re-import slId=${slId}`);
  if (target.length > 15) console.log(`  ... and ${target.length - 15} more`);
  console.log("\nDry run complete. Re-run without --dry-run to execute.");
  process.exit(0);
}

// --- Build Gong + SL indexes ---
const gongByEmail = new Map();
const gongByName = new Map();
{
  let cursor;
  do {
    const url = new URL(`${GBASE}/v2/users`);
    if (cursor) url.searchParams.set("cursor", cursor);
    const r = await fetch(url, { headers: { Authorization: gAuth } });
    const j = await r.json();
    for (const u of j.users || []) {
      const name = [u.firstName, u.lastName].filter(Boolean).join(" ") || u.emailAddress;
      const rec = { id: u.id, name, email: u.emailAddress, active: u.active };
      if (u.emailAddress) gongByEmail.set(u.emailAddress.toLowerCase(), rec);
      if (name && u.active !== false) {
        const key = name.toLowerCase().trim();
        if (!gongByName.has(key)) gongByName.set(key, rec);
      }
    }
    cursor = j.records?.cursor;
  } while (cursor);
}
const fallbackUser = gongByEmail.get(fallbackEmail);
if (!fallbackUser || fallbackUser.active === false) {
  console.error(`Fallback user "${fallbackEmail}" not found or inactive`);
  process.exit(1);
}

const slById = new Map();
const slByGuid = new Map();
{
  let page = 1;
  while (true) {
    const r = await fetch(`https://api.salesloft.com/v2/users?per_page=100&page=${page}`, { headers: slH });
    const j = await r.json();
    for (const u of j.data || []) {
      const rec = { id: u.id, guid: u.guid, name: u.name, email: u.email, active: u.active };
      slById.set(String(u.id), rec);
      if (u.guid) slByGuid.set(u.guid, rec);
    }
    if (!j.metadata?.paging?.next_page) break;
    page = j.metadata.paging.next_page;
  }
}
console.log(`Gong users:     ${gongByEmail.size}`);
console.log(`SL users:       ${slById.size}`);
console.log("");

function resolveOwner(c) {
  const slUser = c.owner_id ? (slByGuid.get(c.owner_id) || slById.get(String(c.owner_id))) : null;
  const ownerEmailRaw = (slUser?.email || "").toLowerCase() || null;
  const ownerNameRaw = (slUser?.name || "").toLowerCase().trim() || null;
  if (ownerEmailRaw) {
    const byEmail = gongByEmail.get(ownerEmailRaw);
    if (byEmail && byEmail.active !== false) return { user: byEmail, source: "owner-email", ownerEmailRaw };
  }
  if (ownerNameRaw) {
    const byName = gongByName.get(ownerNameRaw);
    if (byName && byName.active !== false) return { user: byName, source: "owner-name", ownerEmailRaw };
  }
  return { user: fallbackUser, source: "fallback", ownerEmailRaw };
}

async function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
async function fetchWithRetry(url, opts = {}, label = "fetch") {
  for (let attempt = 0; attempt < 6; attempt++) {
    try {
      const r = await fetch(url, opts);
      if (r.status === 429) { const w = Number(r.headers.get("retry-after") || 5); await sleep(w * 1000); continue; }
      if (r.status >= 500 && r.status < 600) { await sleep(Math.min(60, 2 ** (attempt + 2)) * 1000); continue; }
      return r;
    } catch (err) {
      await sleep(Math.min(60, 2 ** (attempt + 2)) * 1000);
    }
  }
  throw new Error(`${label}: retries exhausted`);
}

async function slGet(p) {
  const r = await fetchWithRetry(`https://api.salesloft.com${p}`, { headers: slH }, `SL ${p}`);
  if (!r.ok) throw new Error(`SL ${p} → ${r.status}`);
  return r.json();
}
async function slSignedRecordingUrl(id) {
  const r = await fetchWithRetry(`https://api.salesloft.com/v2/conversations/${id}/recording`, { headers: slH, redirect: "manual" }, `SL recording ${id}`);
  if (r.status >= 300 && r.status < 400) return r.headers.get("location");
  if (!r.ok) throw new Error(`SL recording → ${r.status}`);
  const j = await r.json();
  return j.data?.url || j.data?.recording_url || j.url;
}

function cleanEmail(raw) {
  const e = (raw || "").trim().toLowerCase();
  if (!e || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) return "";
  return e;
}
function nameSlug(n) { return n.toLowerCase().replace(/\([^)]*\)/g, "").replace(/[^a-z0-9 ]+/g, " ").trim().replace(/\s+/g, "."); }

function buildParties(attendees, invitees, primary) {
  const raw = [{ userId: primary.id, affiliation: "Internal" }];
  for (const a of attendees || []) {
    const email = cleanEmail(a.email);
    const name = (a.full_name || "").trim() || undefined;
    raw.push({ name, email: email || undefined, affiliation: a.is_internal ? "Internal" : "External" });
  }
  for (const i of invitees || []) {
    const email = cleanEmail(i.email);
    const name = (i.full_name || "").trim() || undefined;
    if (!email && !name) continue;
    const internal = email.endsWith("@outboundfunnel.com") || email.endsWith("@2x.marketing");
    raw.push({ name, email: email || undefined, affiliation: internal ? "Internal" : "External" });
  }
  const merged = [];
  for (const r of raw) {
    let entry = { ...r };
    if (!entry.userId && entry.email) {
      const gu = gongByEmail.get(entry.email);
      if (gu && gu.active !== false) entry = { userId: gu.id, affiliation: "Internal" };
    }
    if (!entry.userId && entry.name) {
      const gu = gongByName.get(entry.name.toLowerCase().trim());
      if (gu && gu.active !== false) entry = { userId: gu.id, affiliation: "Internal" };
    }
    const idx = merged.findIndex(m =>
      (entry.userId && m.userId === entry.userId) ||
      (entry.email && m.email === entry.email) ||
      (entry.name && m.name && nameSlug(entry.name) === nameSlug(m.name))
    );
    if (idx === -1) merged.push(entry);
    else {
      const m = merged[idx];
      if (entry.userId && !m.userId) m.userId = entry.userId;
      if (entry.email && !m.email) m.email = entry.email;
      if (entry.name && !m.name) m.name = entry.name;
      if (entry.affiliation === "Internal") m.affiliation = "Internal";
    }
  }
  return merged.map(m => m.userId
    ? { userId: m.userId, affiliation: "Internal" }
    : { ...(m.name && { name: m.name }), ...(m.email && { emailAddress: m.email }), affiliation: m.affiliation || "Unknown" });
}

const MONTHS = ["January","February","March","April","May","June","July","August","September","October","November","December"];
function ordinal(n) { if (n>=11&&n<=13) return `${n}th`; switch(n%10){case 1:return `${n}st`;case 2:return `${n}nd`;case 3:return `${n}rd`;default:return `${n}th`;} }
const importTag = `Import · ${MONTHS[new Date().getMonth()]} ${ordinal(new Date().getDate())} ${new Date().getFullYear()}`;
const importDate = new Date().toISOString().slice(0, 10);

const logStream = createWriteStream(LOG_PATH, { flags: "a" });
const logEvent = (e) => logStream.write(JSON.stringify({ t: new Date().toISOString(), ...e }) + "\n");

const stats = { ok: 0, dedup: 0, error: 0 };
const startedAt = Date.now();

for (let i = 0; i < target.length; i++) {
  const slId = target[i];
  const tag = `[${i + 1}/${target.length}]`;
  try {
    const ext = (await slGet(`/v2/conversations/${slId}/extensive`)).data;
    if (!ext) throw new Error("no SL conversation data");
    const { user: repUser, source: repSource, ownerEmailRaw } = resolveOwner(ext);
    const baseTitle = ext.title || `Salesloft call ${slId}`;
    const started = new Date(ext.started_recording_at ?? ext.event_start_date ?? ext.created_at).toISOString();
    const durationSec = Math.max(1, Math.round((ext.duration ?? 0) / 1000));
    const parties = buildParties(ext.attendees || [], ext.invitees || [], repUser);

    const metadata = {
      clientUniqueId: cuidSuffix ? `salesloft-${slId}-${cuidSuffix}` : `salesloft-${slId}`,
      title: `${baseTitle} · ${importTag}`,
      actualStart: started,
      duration: durationSec,
      direction: "Conference",
      primaryUser: repUser.id,
      parties,
      customData: `salesloft-cleanup-reimport:${importDate}`,
      ...(ext.language_code && { languageCode: ext.language_code }),
    };

    console.log(`${tag} ${slId} — "${baseTitle.slice(0, 60)}"  rep=${repUser.email} [${repSource}]`);

    const cr = await fetchWithRetry(`${GBASE}/v2/calls`, {
      method: "POST",
      headers: { Authorization: gAuth, "Content-Type": "application/json" },
      body: JSON.stringify(metadata),
    }, "POST /v2/calls");
    const crBody = await cr.text();
    let callId, reused = false;
    if (cr.ok) callId = JSON.parse(crBody).callId;
    else if (cr.status === 400 && crBody.includes("has already been posted")) {
      const m = crBody.match(/posted for the call (\d+)/);
      callId = m && m[1]; reused = true;
    } else throw new Error(`POST → ${cr.status} ${crBody.slice(0, 150)}`);
    console.log(`${tag}   ${reused ? "reused" : "created"} callId=${callId} · ${parties.length} parties`);

    const recUrl = await slSignedRecordingUrl(slId);
    const dl = await fetchWithRetry(recUrl, {}, `download ${slId}`);
    const buf = Buffer.from(await dl.arrayBuffer());
    const sizeMB = +(buf.length / 1024 / 1024).toFixed(2);

    const form = new FormData();
    form.append("mediaFile", new Blob([buf], { type: "audio/mp4" }), "recording.m4a");
    const up = await fetchWithRetry(`${GBASE}/v2/calls/${callId}/media`, {
      method: "PUT",
      headers: { Authorization: gAuth },
      body: form,
    }, `upload ${slId}`);
    const upBody = await up.text();
    if (up.ok) {
      stats.ok++;
      console.log(`${tag}   ✓ ${sizeMB} MB uploaded`);
      logEvent({ slId, callId, status: "ok", title: baseTitle, sizeMB, repEmail: repUser.email, repSource, ownerEmailRaw });
    } else if (up.status === 400 && upBody.includes("has been uploaded in the past")) {
      stats.dedup++;
      const m = upBody.match(/callID with the same content: (\d+)/);
      console.log(`${tag}   ↺ media dedup content-hash (dedupCallId=${m ? m[1] : "?"})`);
      logEvent({ slId, callId, status: "dedup", title: baseTitle, dedupCallId: m ? m[1] : null, reason: "content-hash", repEmail: repUser.email, repSource, ownerEmailRaw });
    } else if (up.status === 400 && upBody.includes("has already been handled")) {
      // Media is already attached to this callId — first attempt succeeded
      // server-side even if we lost the response. Treat as success.
      stats.dedup++;
      console.log(`${tag}   ↺ media already-handled (call ${callId} has audio)`);
      logEvent({ slId, callId, status: "dedup", title: baseTitle, dedupCallId: callId, reason: "already-handled", repEmail: repUser.email, repSource, ownerEmailRaw });
    } else throw new Error(`upload → ${up.status} ${upBody.slice(0, 150)}`);
  } catch (err) {
    stats.error++;
    console.log(`${tag}   ✗ ERROR: ${err.message}`);
    logEvent({ slId, status: "error", error: err.message });
  }

  if ((i + 1) % 25 === 0 || i + 1 === target.length) {
    const min = ((Date.now() - startedAt) / 60000).toFixed(1);
    console.log(`──── progress: ${i + 1}/${target.length}  ok=${stats.ok}  dedup=${stats.dedup}  err=${stats.error}  elapsed=${min}min`);
  }
}

console.log("\n=== DONE ===");
console.log(`Total processed: ${target.length}`);
console.log(`  ok:    ${stats.ok}`);
console.log(`  dedup: ${stats.dedup}`);
console.log(`  error: ${stats.error}`);
console.log(`\nLog: ${path.relative(process.cwd(), LOG_PATH)}`);
logStream.end();
