#!/usr/bin/env node
// Bulk import every Salesloft conversation into Gong using the verified
// pipeline: full participant data, "Import · <date>" tag, customData
// stamp, audio/mp4 multipart upload, idempotent on Gong dedup.
//
// Each call's outcome is appended to scripts/salesloft-bulk.jsonl so the
// run is resumable / auditable. The clientUniqueId is `salesloft-{slId}`,
// so reruns of already-completed calls return Gong's existing callId
// without creating duplicates.
//
// primaryUser is resolved per-call from the SL conversation's owner:
// c.owner_id → SL /v2/users → email match → name match. The resolved
// rep is used as the Gong primaryUser directly (true ownership). Falls
// back to --primary (default Ben) when the SL owner doesn't map to an
// active Gong user. The JSONL log records repEmail/repSource so post-run
// audits show which calls hit the fallback.
//
// Requires the target rep's settings.telephonyCallsImported=true in
// Gong. Verify via Admin → Team members → user → Data capture → Telephony
// calls. Without that flag, POST /v2/calls 409s for that user.
//
// Usage:
//   node scripts/salesloft-to-gong-bulk.mjs                                 # everything, oldest first
//   node scripts/salesloft-to-gong-bulk.mjs --primary ben.mcwilliams@2x.marketing   # fallback when rep is missing in Gong
//   node scripts/salesloft-to-gong-bulk.mjs --limit 5                       # smoke-test slice
//   node scripts/salesloft-to-gong-bulk.mjs --resume                        # skip slIds already in the JSONL log
//   node scripts/salesloft-to-gong-bulk.mjs --dry-run                       # plan only: no createCall, no upload

import fs from "node:fs/promises";
import { createWriteStream, existsSync, readFileSync } from "node:fs";
import path from "node:path";

// --- env ----------------------------------------------------------------
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
const fallbackEmail = arg("--primary", "ben.mcwilliams@2x.marketing").toLowerCase();
const limit = arg("--limit") ? Number(arg("--limit")) : null;
const resume = flag("--resume");
const dryRun = flag("--dry-run");

// --email-map "sl1@old.com=gong1@new.com,sl2@old.com=gong2@new.com"
// Explicit SL→Gong email overrides, used after the email lookup but before
// the name fallback. Useful when one rep's name in SL doesn't match Gong
// (nickname / typo / multiple matches).
const emailOverrides = new Map();
{
  const raw = arg("--email-map", "");
  if (raw) {
    for (const pair of raw.split(",")) {
      const [from, to] = pair.split("=").map((s) => s.trim().toLowerCase());
      if (from && to) emailOverrides.set(from, to);
    }
  }
}

const LOG_PATH = path.resolve("./scripts/salesloft-bulk.jsonl");

// Build resume set from existing JSONL log
const completed = new Set();
if (resume && existsSync(LOG_PATH)) {
  for (const line of readFileSync(LOG_PATH, "utf8").split("\n")) {
    if (!line.trim()) continue;
    try {
      const e = JSON.parse(line);
      if (e.status === "ok" || e.status === "dedup") completed.add(e.slId);
    } catch {}
  }
  console.log(`Resume: ${completed.size} slIds already completed; will skip those.`);
}

const logStream = createWriteStream(LOG_PATH, { flags: "a" });
function logEvent(event) {
  logStream.write(JSON.stringify({ t: new Date().toISOString(), ...event }) + "\n");
}

// --- Gong user index ---
// Indexed by both email and display name. The name index exists because the
// SL tenant uses @outboundfunnel.com emails and the Gong tenant uses
// @2x.marketing emails (rebrand) — without a name fallback, ~0% of SL owners
// would map to a Gong user.
const gongByEmail = new Map();
const gongByName = new Map();
const nameCollisions = [];
{
  let cursor;
  do {
    const url = new URL(`${GBASE}/v2/users`);
    if (cursor) url.searchParams.set("cursor", cursor);
    const r = await fetch(url, { headers: { Authorization: gAuth } });
    const j = await r.json();
    for (const u of j.users || []) {
      const rec = {
        id: u.id,
        name: [u.firstName, u.lastName].filter(Boolean).join(" ") || u.emailAddress,
        email: u.emailAddress,
        active: u.active,
      };
      if (u.emailAddress) gongByEmail.set(u.emailAddress.toLowerCase(), rec);
      if (rec.name && u.active !== false) {
        const key = rec.name.toLowerCase().trim();
        if (gongByName.has(key)) nameCollisions.push(rec.name);
        else gongByName.set(key, rec);
      }
    }
    cursor = j.records?.cursor;
  } while (cursor);
}
if (nameCollisions.length) {
  console.warn(`⚠ Gong has duplicate active-user names; name fallback will pick the FIRST and ignore the rest: ${nameCollisions.join(", ")}`);
}
const fallbackUser = gongByEmail.get(fallbackEmail);
if (!fallbackUser || fallbackUser.active === false) {
  console.error(`Fallback user "${fallbackEmail}" not found or inactive in Gong`);
  process.exit(1);
}

// --- Salesloft user index ---
// Mirrors scripts/route-salesloft-import.mjs:58-74. Each conversation list row
// has an `owner_id`; we resolve that to a real email so we can map to a Gong
// user and use them as primaryUser instead of always falling back to Ben.
const slById = new Map();
const slByGuid = new Map();
{
  let page = 1;
  while (true) {
    const r = await fetch(`https://api.salesloft.com/v2/users?per_page=100&page=${page}`, { headers: slH });
    if (!r.ok) {
      console.error(`SL /v2/users → ${r.status} ${await r.text()}`);
      process.exit(1);
    }
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

// Resolves which Gong user should own the call.
// 1. Look up c.owner_id in the SL user index → get rep email.
// 2. Map that email to an active Gong user. If found, use them.
// 3. Otherwise fall back to fallbackUser (default Ben).
// Returns { user, source, ownerEmailRaw } where source is "owner" or "fallback"
// and ownerEmailRaw is the rep's SL email (or null) for audit logging.
function resolveOwner(c) {
  const slUser = c.owner_id ? (slByGuid.get(c.owner_id) || slById.get(String(c.owner_id))) : null;
  const ownerEmailRaw = (slUser?.email || "").toLowerCase() || null;
  const ownerNameRaw = (slUser?.name || "").toLowerCase().trim() || null;

  // 1. Try email match (works when SL and Gong share domain).
  if (ownerEmailRaw) {
    const byEmail = gongByEmail.get(ownerEmailRaw);
    if (byEmail && byEmail.active !== false) {
      return { user: byEmail, source: "owner-email", ownerEmailRaw };
    }
  }
  // 2. Try explicit email override (SL→Gong map), e.g. cross-domain rebrand.
  if (ownerEmailRaw && emailOverrides.has(ownerEmailRaw)) {
    const target = emailOverrides.get(ownerEmailRaw);
    const byOverride = gongByEmail.get(target);
    if (byOverride && byOverride.active !== false) {
      return { user: byOverride, source: "owner-override", ownerEmailRaw };
    }
  }
  // 3. Try display-name match (catches rebrands where the same person has
  //    a new email in Gong but the same name).
  if (ownerNameRaw) {
    const byName = gongByName.get(ownerNameRaw);
    if (byName && byName.active !== false) {
      return { user: byName, source: "owner-name", ownerEmailRaw };
    }
  }
  return { user: fallbackUser, source: "fallback", ownerEmailRaw };
}

const MONTHS = ["January","February","March","April","May","June","July","August","September","October","November","December"];
function ordinal(n) { if (n>=11&&n<=13) return `${n}th`; switch(n%10){case 1:return `${n}st`;case 2:return `${n}nd`;case 3:return `${n}rd`;default:return `${n}th`;} }
function prettyDate(d) { return `${MONTHS[d.getMonth()]} ${ordinal(d.getDate())} ${d.getFullYear()}`; }
const importTag = `Import · ${prettyDate(new Date())}`;
const importDate = new Date().toISOString().slice(0, 10);

function normalizeStarted(c) {
  const raw = c.started_recording_at ?? c.event_start_date ?? c.created_at;
  if (typeof raw === "number") return new Date(raw < 1e11 ? raw * 1000 : raw).toISOString();
  return new Date(raw ?? Date.now()).toISOString();
}

function nameSlug(name) {
  return name.toLowerCase().replace(/\([^)]*\)/g, "").replace(/[^a-z0-9 ]+/g, " ").trim().replace(/\s+/g, ".");
}
function emailMatchesName(email, name) {
  if (!email || !name) return false;
  const user = email.split("@")[0].toLowerCase().replace(/\+.*$/, "");
  const slug = nameSlug(name);
  if (!slug) return false;
  if (user === slug) return true;
  const [first] = slug.split(".");
  return !!first && user === first;
}

// Sanitize an email: keep only well-formed values. Salesloft sometimes
// stores literal junk like "na" / "n/a" / "-" / "none" — Gong rejects
// those with 400 "is not a valid email address".
function cleanEmail(raw) {
  const e = (raw || "").trim().toLowerCase();
  if (!e) return "";
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) return "";
  return e;
}

// Builds the Gong `parties` array. `primary` is the permissioned Gong user
// who will be primaryUser (the only user Gong allows as call owner — see
// memory/gong-call-import-permission.md). `rep` is the actual call rep
// resolved from c.owner_id; we inject them as a userId-bound party so the
// Gong UI's "filter by user" surfaces this call under the rep. Attendees
// and invitees are also resolved to Gong userIds via both email and name
// match where possible.
function buildParties(attendees, invitees, primary, rep) {
  const raw = [];
  raw.push({ userId: primary.id, affiliation: "Internal" });
  if (rep && rep.id !== primary.id) {
    raw.push({ userId: rep.id, affiliation: "Internal" });
  }
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
  function findIndex(entry) {
    for (let i = 0; i < merged.length; i++) {
      const m = merged[i];
      if (entry.userId && m.userId === entry.userId) return i;
      if (entry.email && m.email === entry.email) return i;
      if (entry.email && m.name && emailMatchesName(entry.email, m.name)) return i;
      if (entry.name && m.email && emailMatchesName(m.email, entry.name)) return i;
      if (entry.name && m.name && nameSlug(entry.name) === nameSlug(m.name)) return i;
    }
    return -1;
  }
  for (const r of raw) {
    let entry = { ...r };
    if (!entry.userId && entry.email) {
      const gu = gongByEmail.get(entry.email);
      if (gu && gu.active !== false) entry = { userId: gu.id, affiliation: "Internal" };
    }
    // Name-match fallback — same rebrand-handling as resolveOwner.
    if (!entry.userId && entry.name) {
      const gu = gongByName.get(entry.name.toLowerCase().trim());
      if (gu && gu.active !== false) entry = { userId: gu.id, affiliation: "Internal" };
    }
    const idx = findIndex(entry);
    if (idx === -1) merged.push(entry);
    else {
      const m = merged[idx];
      if (entry.userId && !m.userId) m.userId = entry.userId;
      if (entry.email && !m.email) m.email = entry.email;
      if (entry.name && !m.name) m.name = entry.name;
      if (entry.affiliation === "Internal") m.affiliation = "Internal";
    }
  }
  return merged.map((m) => m.userId
    ? { userId: m.userId, affiliation: "Internal" }
    : { ...(m.name && { name: m.name }), ...(m.email && { emailAddress: m.email }), affiliation: m.affiliation || "Unknown" });
}

// --- API helpers with retry --------------------------------------------
async function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

// Generic retrying fetch. Retries on network errors (TypeError "fetch failed",
// DNS, ECONN*) and on HTTP 429/5xx with exponential backoff. Returns the
// Response on the final attempt regardless of status; the caller is
// responsible for checking r.ok and parsing the body.
async function fetchWithRetry(url, opts = {}, label = "fetch") {
  const MAX = 6;
  let lastErr;
  for (let attempt = 0; attempt < MAX; attempt++) {
    try {
      const r = await fetch(url, opts);
      if (r.status === 429) {
        const wait = Number(r.headers.get("retry-after") || 5);
        console.log(`        ${label}: 429 — sleeping ${wait}s (attempt ${attempt + 1}/${MAX})`);
        await sleep(wait * 1000);
        continue;
      }
      if (r.status >= 500 && r.status < 600) {
        const wait = Math.min(60, 2 ** (attempt + 2));
        console.log(`        ${label}: ${r.status} — backoff ${wait}s (attempt ${attempt + 1}/${MAX})`);
        await sleep(wait * 1000);
        continue;
      }
      return r;
    } catch (err) {
      lastErr = err;
      const wait = Math.min(60, 2 ** (attempt + 2));
      console.log(`        ${label}: ${err.message} — backoff ${wait}s (attempt ${attempt + 1}/${MAX})`);
      await sleep(wait * 1000);
    }
  }
  throw lastErr || new Error(`${label}: retried out`);
}

async function slGet(p) {
  const r = await fetchWithRetry(`https://api.salesloft.com${p}`, { headers: slH }, `SL ${p}`);
  if (!r.ok) throw new Error(`SL ${p} → ${r.status} ${(await r.text()).slice(0, 200)}`);
  return r.json();
}
async function slSignedRecordingUrl(id) {
  const r = await fetchWithRetry(`https://api.salesloft.com/v2/conversations/${id}/recording`, { headers: slH, redirect: "manual" }, `SL recording ${id}`);
  if (r.status >= 300 && r.status < 400) return r.headers.get("location");
  if (!r.ok) throw new Error(`SL recording → ${r.status} ${(await r.text()).slice(0, 200)}`);
  const j = await r.json();
  return j.data?.url || j.data?.recording_url || j.url;
}

async function gongCreateCall(metadata) {
  const r = await fetchWithRetry(`${GBASE}/v2/calls`, {
    method: "POST",
    headers: { Authorization: gAuth, "Content-Type": "application/json" },
    body: JSON.stringify(metadata),
  }, "POST /v2/calls");
  const body = await r.text();
  if (!r.ok) {
    if (r.status === 400 && body.includes("has already been posted for the call")) {
      const m = body.match(/posted for the call (\d+)/);
      if (m) return { callId: m[1], reused: true };
    }
    throw new Error(`POST /v2/calls → ${r.status} ${body.slice(0, 300)}`);
  }
  const j = JSON.parse(body);
  return { callId: j.callId || j.callIds?.[0] || j.id, reused: false };
}

async function gongUploadMedia(callId, buf, contentType, filename) {
  const form = new FormData();
  form.append("mediaFile", new Blob([buf], { type: contentType }), filename);
  const r = await fetchWithRetry(`${GBASE}/v2/calls/${encodeURIComponent(callId)}/media`, {
    method: "PUT",
    headers: { Authorization: gAuth },
    body: form,
  }, `PUT media ${callId}`);
  const body = await r.text();
  if (!r.ok) {
    if (r.status === 400 && body.includes("has been uploaded in the past")) {
      const m = body.match(/callID with the same content: (\d+)/);
      return { dedup: true, dedupCallId: m ? m[1] : null, reason: "content-hash" };
    }
    if (r.status === 400 && body.includes("has already been handled")) {
      // The call already has media attached. The first upload attempt may
      // have completed server-side even though our previous run lost the
      // response; either way the call is in Gong with media. Treat as ok.
      return { dedup: true, dedupCallId: callId, reason: "already-handled" };
    }
    throw new Error(`PUT media → ${r.status} ${body.slice(0, 300)}`);
  }
  return { dedup: false };
}

// --- Walk all SL conversations, oldest first ----------------------------
async function pullAllConversations() {
  const out = [];
  let page = 1;
  while (true) {
    const j = await slGet(`/v2/conversations?per_page=100&page=${page}&sort_by=created_at&sort_direction=asc`);
    const rows = j.data || [];
    if (!rows.length) break;
    out.push(...rows);
    if (!j.metadata?.paging?.next_page) break;
    page = j.metadata.paging.next_page;
  }
  return out;
}

console.log(`Fallback user:  ${fallbackUser.name} <${fallbackUser.email}>  (used when SL owner isn't an active Gong user)`);
console.log(`SL users:       ${slById.size}`);
console.log(`Gong users:     ${gongByEmail.size}`);
console.log(`Import tag:     "${importTag}"`);
console.log(`Tenant:         ${GBASE}`);
console.log(`Log file:       ${path.relative(process.cwd(), LOG_PATH)}`);
if (dryRun) console.log(`Mode:           DRY RUN (no createCall, no upload)`);
console.log("");

console.log("Pulling all Salesloft conversations (oldest first)...");
let convs = await pullAllConversations();
console.log(`Total conversations: ${convs.length}`);
if (resume && completed.size) {
  convs = convs.filter((c) => !completed.has(c.id));
  console.log(`After resume filter:  ${convs.length}`);
}
if (limit) {
  convs = convs.slice(0, limit);
  console.log(`After --limit ${limit}: ${convs.length}`);
}
console.log("");

const startedAt = Date.now();
const stats = { ok: 0, dedup: 0, error: 0, ownerKept: 0, ownerFallback: 0, byEmail: 0, byOverride: 0, byName: 0 };
const fallbackByOwnerEmail = new Map(); // for dry-run audit summary

let i = 0;
for (const c of convs) {
  i++;
  const tag = `[${i}/${convs.length}]`;
  const slId = c.id;
  const baseTitle = c.title || `Salesloft call ${slId}`;

  // Resolve the actual rep (Sarah etc.) — used only to inject as a userId
  // party. Gong's call-import permission gate forces primaryUser=Ben.
  const { user: repUser, source: repSource, ownerEmailRaw } = resolveOwner(c);
  if (repSource === "fallback") {
    stats.ownerFallback++;
    const key = ownerEmailRaw || "(no SL owner email)";
    fallbackByOwnerEmail.set(key, (fallbackByOwnerEmail.get(key) || 0) + 1);
  } else {
    stats.ownerKept++;
    if (repSource === "owner-email") stats.byEmail++;
    else if (repSource === "owner-override") stats.byOverride++;
    else if (repSource === "owner-name") stats.byName++;
  }

  const repLabel = repSource === "fallback"
    ? `(no rep resolved; SL owner: ${ownerEmailRaw || "none"})`
    : `rep=${repUser.email} [${repSource}]`;
  console.log(`${tag} ${slId} — "${baseTitle}"  ${repLabel}`);

  if (dryRun) {
    logEvent({ slId, status: "dry-run", title: baseTitle, repEmail: repUser.email, repSource, ownerEmailRaw });
    continue;
  }

  let phase = "init";
  try {
    phase = "salesloft-extensive";
    const ext = (await slGet(`/v2/conversations/${slId}/extensive`)).data || c;

    const started = normalizeStarted(ext);
    const durationSec = Math.max(1, Math.round((ext.duration ?? 0) / 1000));
    // True ownership: the resolved rep IS the primaryUser. When resolveOwner
    // falls back (rep not in Gong or inactive), repUser is the fallback user,
    // so primaryUser=Ben for those calls.
    const parties = buildParties(ext.attendees || [], ext.invitees || [], repUser);

    const metadata = {
      clientUniqueId: `salesloft-${slId}`,
      title: `${baseTitle} · ${importTag}`,
      actualStart: started,
      duration: durationSec,
      direction: "Conference",
      primaryUser: repUser.id,
      parties,
      customData: `salesloft-import:${importDate}`,
      ...(ext.language_code && { languageCode: ext.language_code }),
    };

    phase = "create-call";
    const { callId, reused } = await gongCreateCall(metadata);
    console.log(`${tag}   ${reused ? "reused" : "created"} Gong callId=${callId} · ${parties.length} parties · ${(durationSec / 60).toFixed(1)}min`);

    phase = "salesloft-recording-url";
    const recUrl = await slSignedRecordingUrl(slId);

    phase = "download";
    const dl = await fetchWithRetry(recUrl, {}, `recording download ${slId}`);
    if (!dl.ok) throw new Error(`recording download → ${dl.status}`);
    const buf = Buffer.from(await dl.arrayBuffer());
    const sizeMB = +(buf.length / 1024 / 1024).toFixed(2);

    phase = "upload";
    const upStart = Date.now();
    const upResult = await gongUploadMedia(callId, buf, "audio/mp4", "recording.m4a");
    const upMs = Date.now() - upStart;

    if (upResult.dedup) {
      stats.dedup++;
      console.log(`${tag}   ↺ media dedup (existing callID ${upResult.dedupCallId}) · counted as success`);
      logEvent({ slId, callId, status: "dedup", title: baseTitle, sizeMB, parties: parties.length, dedupCallId: upResult.dedupCallId, repEmail: repUser.email, repSource, ownerEmailRaw });
    } else {
      stats.ok++;
      console.log(`${tag}   ✓ ${sizeMB} MB uploaded in ${(upMs / 1000).toFixed(1)}s`);
      logEvent({ slId, callId, status: "ok", title: baseTitle, sizeMB, parties: parties.length, uploadMs: upMs, repEmail: repUser.email, repSource, ownerEmailRaw });
    }
  } catch (err) {
    stats.error++;
    const msg = err.message;
    console.log(`${tag}   ✗ ERROR (${phase}): ${msg.slice(0, 200)}`);
    logEvent({ slId, status: "error", phase, title: baseTitle, error: msg, repEmail: repUser.email, repSource, ownerEmailRaw });
  }

  // Progress every 10 calls
  if (i % 10 === 0 || i === convs.length) {
    const elapsedMin = ((Date.now() - startedAt) / 60000).toFixed(1);
    const rate = i / ((Date.now() - startedAt) / 60000);
    const eta = (convs.length - i) / rate;
    console.log(`──── progress: ${i}/${convs.length}  ok=${stats.ok}  dedup=${stats.dedup}  err=${stats.error}  elapsed=${elapsedMin}min  rate=${rate.toFixed(1)}/min  eta≈${eta.toFixed(0)}min`);
  }
}

console.log("");
console.log("=== DONE ===");
console.log(`Total: ${convs.length}`);
if (!dryRun) {
  console.log(`  ok:    ${stats.ok}`);
  console.log(`  dedup: ${stats.dedup}  (already in Gong; metadata shell created if new clientUniqueId)`);
  console.log(`  error: ${stats.error}`);
}
console.log("");
console.log("Rep attribution (rep is injected as a userId party; primaryUser stays as Ben):");
console.log(`  ✓ rep resolved:    ${stats.ownerKept}`);
console.log(`      via email match:        ${stats.byEmail}`);
console.log(`      via --email-map:        ${stats.byOverride}`);
console.log(`      via name match:         ${stats.byName}`);
console.log(`  ↪ no rep mapped (Ben only): ${stats.ownerFallback}`);
if (fallbackByOwnerEmail.size) {
  console.log("");
  console.log("Fallback breakdown (SL owner → fallback count):");
  for (const [email, n] of Array.from(fallbackByOwnerEmail).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${String(n).padStart(4)}  ${email}`);
  }
}
console.log("");
console.log(`Per-call log: ${path.relative(process.cwd(), LOG_PATH)}`);
if (!dryRun) console.log(`Re-run with --resume to retry only failures.`);
logStream.end();
