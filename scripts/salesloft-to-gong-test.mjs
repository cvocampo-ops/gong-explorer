#!/usr/bin/env node
// Live test: pull N Salesloft conversations and import each into Gong using
// the EXACT logic the bulk runner will use (full participants, import tag,
// customData, audio/mp4 multipart upload, idempotent on dedup).
//
// Usage:
//   node scripts/salesloft-to-gong-test.mjs                      # 1 call (most recent)
//   node scripts/salesloft-to-gong-test.mjs --limit 5
//   node scripts/salesloft-to-gong-test.mjs --primary ben.mcwilliams@2x.marketing

import fs from "node:fs/promises";
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
const arg = (f, d) => {
  const i = args.indexOf(f);
  return i >= 0 ? args[i + 1] : d;
};
const limit = Number(arg("--limit", "1"));
const offset = Number(arg("--offset", "0"));
const primaryEmail = arg("--primary", "ben.mcwilliams@2x.marketing").toLowerCase();

// Best-effort derivation of the Gong UI host from the API base URL
// e.g. https://us-5470.api.gong.io → https://us-5470.app.gong.io
const gongUiBase = GBASE.replace(/^(https?:\/\/[^/.]*\.)?api\.gong\.io/, (_, p) => `${p ?? ""}app.gong.io`).replace(".api.", ".app.");

// --- Build Gong user index ----------------------------------------------
const gongByEmail = new Map();
const gongById = new Map();
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
      gongById.set(u.id, rec);
      if (u.emailAddress) gongByEmail.set(u.emailAddress.toLowerCase(), rec);
    }
    cursor = j.records?.cursor;
  } while (cursor);
}
const primaryUser = gongByEmail.get(primaryEmail);
if (!primaryUser || primaryUser.active === false) {
  console.error(`Primary user "${primaryEmail}" not found or inactive in Gong`);
  process.exit(1);
}

// --- Date + tag formatting ---
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
  return name
    .toLowerCase()
    .replace(/\([^)]*\)/g, "")
    .replace(/[^a-z0-9 ]+/g, " ")
    .trim()
    .replace(/\s+/g, ".");
}
function emailMatchesName(email, name) {
  if (!email || !name) return false;
  const user = email.split("@")[0].toLowerCase().replace(/\+.*$/, "");
  const slug = nameSlug(name);
  if (!slug) return false;
  if (user === slug) return true;
  const [first] = slug.split(".");
  if (first && user === first) return true;
  return false;
}

function buildParties(attendees, invitees, primary) {
  const raw = [];
  raw.push({ userId: primary.id, affiliation: "Internal" });
  for (const a of attendees || []) {
    const email = (a.email || "").trim().toLowerCase();
    const name = (a.full_name || "").trim() || undefined;
    raw.push({ name, email, affiliation: a.is_internal ? "Internal" : "External" });
  }
  for (const i of invitees || []) {
    const email = (i.email || "").trim().toLowerCase();
    const name = (i.full_name || "").trim() || undefined;
    if (!email && !name) continue;
    const internal = email.endsWith("@outboundfunnel.com") || email.endsWith("@2x.marketing");
    raw.push({ name, email, affiliation: internal ? "Internal" : "External" });
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

// --- API helpers --------------------------------------------------------
async function slGet(p) {
  const r = await fetch(`https://api.salesloft.com${p}`, { headers: slH });
  if (!r.ok) throw new Error(`SL ${p} → ${r.status} ${await r.text()}`);
  return r.json();
}
async function slSignedRecordingUrl(id) {
  const r = await fetch(`https://api.salesloft.com/v2/conversations/${id}/recording`, { headers: slH, redirect: "manual" });
  if (r.status >= 300 && r.status < 400) return r.headers.get("location");
  if (!r.ok) throw new Error(`SL recording → ${r.status} ${await r.text()}`);
  const j = await r.json();
  return j.data?.url || j.data?.recording_url || j.url;
}

async function gongCreateCall(metadata) {
  const r = await fetch(`${GBASE}/v2/calls`, {
    method: "POST",
    headers: { Authorization: gAuth, "Content-Type": "application/json" },
    body: JSON.stringify(metadata),
  });
  const body = await r.text();
  if (!r.ok) {
    if (r.status === 400 && body.includes("has already been posted for the call")) {
      const m = body.match(/posted for the call (\d+)/);
      if (m) return { callId: m[1], reused: true };
    }
    throw new Error(`POST /v2/calls → ${r.status} ${body}`);
  }
  const j = JSON.parse(body);
  return { callId: j.callId || j.callIds?.[0] || j.id, reused: false };
}
async function gongUploadMedia(callId, buf, contentType, filename) {
  const form = new FormData();
  form.append("mediaFile", new Blob([buf], { type: contentType }), filename);
  const r = await fetch(`${GBASE}/v2/calls/${encodeURIComponent(callId)}/media`, {
    method: "PUT",
    headers: { Authorization: gAuth },
    body: form,
  });
  const body = await r.text();
  if (!r.ok) {
    if (r.status === 400 && body.includes("has been uploaded in the past")) {
      const m = body.match(/callID with the same content: (\d+)/);
      return { dedup: true, body, dedupCallId: m ? m[1] : null };
    }
    throw new Error(`PUT media → ${r.status} ${body}`);
  }
  return { dedup: false };
}

// --- Run ----------------------------------------------------------------
console.log(`Primary user:   ${primaryUser.name} <${primaryUser.email}>`);
console.log(`Import tag:     "${importTag}"`);
console.log(`Tenant:         ${GBASE}`);
console.log("");

// Skip `offset` conversations from the front (handy when retesting and the
// front of the list has been used as test fodder, polluting Gong's
// content-dedup for those bytes). We page through 100 at a time since
// Salesloft caps per_page at 100.
const collected = [];
let slPage = 1;
while (collected.length < offset + limit) {
  const res = await slGet(`/v2/conversations?per_page=100&page=${slPage}&sort_by=created_at&sort_direction=desc`);
  const rows = res.data || [];
  if (!rows.length) break;
  collected.push(...rows);
  if (!res.metadata?.paging?.next_page) break;
  slPage++;
}
const convs = collected.slice(offset, offset + limit);
console.log(`Importing ${convs.length} call(s) into Gong...\n`);

const results = [];
let i = 0;
for (const c of convs) {
  i++;
  const tag = `[${i}/${convs.length}]`;
  console.log(`${tag} SL ${c.id} — "${c.title}"`);
  try {
    const ext = (await slGet(`/v2/conversations/${c.id}/extensive`)).data || c;

    const started = normalizeStarted(ext);
    const durationSec = Math.max(1, Math.round((ext.duration ?? 0) / 1000));
    const parties = buildParties(ext.attendees || [], ext.invitees || [], primaryUser);
    const baseTitle = ext.title || `Salesloft call ${ext.id}`;

    const metadata = {
      clientUniqueId: `salesloft-${ext.id}`,
      title: `${baseTitle} · ${importTag}`,
      actualStart: started,
      duration: durationSec,
      direction: "Conference",
      primaryUser: primaryUser.id,
      parties,
      customData: `salesloft-import:${importDate}`,
      ...(ext.language_code && { languageCode: ext.language_code }),
    };

    console.log(`${tag}   parties: ${parties.length}, duration: ${(durationSec/60).toFixed(1)}min`);
    const { callId, reused } = await gongCreateCall(metadata);
    console.log(`${tag}   ${reused ? "reused existing" : "created"} Gong callId=${callId}`);

    const recUrl = await slSignedRecordingUrl(c.id);
    const dl = await fetch(recUrl);
    const buf = Buffer.from(await dl.arrayBuffer());
    console.log(`${tag}   downloaded ${(buf.length/1024/1024).toFixed(2)} MB`);

    const upStart = Date.now();
    const upResult = await gongUploadMedia(callId, buf, "audio/mp4", "recording.m4a");
    if (upResult.dedup) {
      console.log(`${tag}   upload  → dedup (already uploaded for this content) — counted as success`);
    } else {
      console.log(`${tag}   uploaded in ${((Date.now()-upStart)/1000).toFixed(1)}s ✓`);
    }

    const url = `${gongUiBase}/call?id=${callId}`;
    console.log(`${tag}   👉 ${url}`);
    results.push({ slId: c.id, callId, url, status: "ok", parties: parties.length, durationSec });
  } catch (err) {
    console.log(`${tag}   ✗ ERROR: ${err.message}`);
    results.push({ slId: c.id, status: "error", error: err.message });
  }
  console.log("");
}

console.log("=== Summary ===");
const ok = results.filter((r) => r.status === "ok");
console.log(`Imported: ${ok.length}/${results.length}`);
for (const r of ok) {
  console.log(`  ✓ SL ${r.slId} → Gong ${r.callId} (${r.parties} parties)`);
  console.log(`    ${r.url}`);
}
const fails = results.filter((r) => r.status === "error");
if (fails.length) {
  console.log("");
  for (const r of fails) console.log(`  ✗ SL ${r.slId}: ${r.error}`);
}

await fs.writeFile(
  path.resolve("./scripts/salesloft-to-gong-test-result.json"),
  JSON.stringify({ generatedAt: new Date().toISOString(), primaryEmail, results }, null, 2)
);
