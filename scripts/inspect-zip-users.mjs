#!/usr/bin/env node
// Usage:
//   node scripts/inspect-zip-users.mjs <path-to-zip>
// Optional env (enables Gong API enrichment):
//   GONG_ACCESS_KEY=...  GONG_ACCESS_KEY_SECRET=...  GONG_BASE_URL=https://api.gong.io

import fs from "node:fs/promises";
import path from "node:path";
import JSZip from "jszip";

const zipPath = process.argv[2];
if (!zipPath) {
  console.error("Usage: node scripts/inspect-zip-users.mjs <path-to-zip>");
  process.exit(1);
}

const buf = await fs.readFile(zipPath);
const zip = await JSZip.loadAsync(buf);

// Collect every metadata.json
const metaFiles = Object.keys(zip.files).filter((n) =>
  n.toLowerCase().endsWith("metadata.json")
);

if (metaFiles.length === 0) {
  console.error("No metadata.json files found in ZIP.");
  process.exit(1);
}

// Map<primaryUserId, { count, sampleCallIds: string[], parties: Set<string> }>
const byUser = new Map();
let parsed = 0;
let missing = 0;

for (const name of metaFiles) {
  const text = await zip.files[name].async("string");
  let meta;
  try {
    meta = JSON.parse(text);
  } catch {
    continue;
  }
  parsed++;
  const md = meta.metaData ?? meta; // support both nested and flat
  const pid = md.primaryUserId;
  if (!pid) {
    missing++;
    continue;
  }
  if (!byUser.has(pid)) {
    byUser.set(pid, { count: 0, sampleCallIds: [], parties: new Set(), internalParties: new Map() });
  }
  const row = byUser.get(pid);
  row.count++;
  if (row.sampleCallIds.length < 3 && md.id) row.sampleCallIds.push(md.id);
  if (Array.isArray(meta.parties)) {
    for (const p of meta.parties) {
      if (p.userId === pid && p.name) row.parties.add(p.name);
      if (p.userId === pid && p.emailAddress) row.parties.add(p.emailAddress);
      // Track other internal users — useful as override candidates
      if (p.affiliation === "Internal" && p.userId && p.userId !== pid) {
        row.internalParties.set(p.userId, p.emailAddress || p.name || p.userId);
      }
    }
  }
}

console.log("");
console.log(`ZIP: ${path.basename(zipPath)}`);
console.log(`metadata.json files found: ${metaFiles.length}`);
console.log(`parsed: ${parsed}   missing primaryUserId: ${missing}`);
console.log(`distinct primary users: ${byUser.size}`);
console.log("");

// Optional API enrichment
const access = process.env.GONG_ACCESS_KEY;
const secret = process.env.GONG_ACCESS_KEY_SECRET;
const baseUrl = (process.env.GONG_BASE_URL || "https://api.gong.io").replace(/\/+$/, "");

const userIndex = new Map(); // id -> { name, email, active }

if (access && secret) {
  console.log("Fetching /v2/users from Gong...");
  const auth = "Basic " + Buffer.from(`${access}:${secret}`).toString("base64");
  let cursor;
  let pages = 0;
  do {
    const url = new URL(`${baseUrl}/v2/users`);
    if (cursor) url.searchParams.set("cursor", cursor);
    const r = await fetch(url, { headers: { Authorization: auth } });
    if (!r.ok) {
      console.error(`Gong /v2/users failed: ${r.status} ${await r.text()}`);
      break;
    }
    const data = await r.json();
    for (const u of data.users || []) {
      userIndex.set(u.id, {
        name: [u.firstName, u.lastName].filter(Boolean).join(" ") || u.emailAddress || u.id,
        email: u.emailAddress,
        active: u.active,
      });
    }
    cursor = data.records?.cursor;
    pages++;
  } while (cursor && pages < 100);
  console.log(`  fetched ${userIndex.size} users across ${pages} page(s).`);
  console.log("");
}

// Sort by call count desc
const rows = Array.from(byUser.entries()).sort((a, b) => b[1].count - a[1].count);

const enabled = [];
const notFound = [];

console.log("primaryUserId             calls  status        identity");
console.log("------------------------- -----  ------------  -----------------------------------");
for (const [id, info] of rows) {
  const u = userIndex.get(id);
  let identity;
  let status;
  if (u) {
    identity = `${u.name}${u.email ? ` <${u.email}>` : ""}`;
    status = u.active === false ? "INACTIVE" : "in workspace";
    enabled.push({ id, name: u.name, email: u.email, count: info.count, active: u.active });
  } else if (userIndex.size > 0) {
    // We did an API pull but didn't find this user
    identity =
      info.parties.size > 0
        ? Array.from(info.parties).slice(0, 2).join(" / ")
        : "(unknown — not in /v2/users)";
    status = "NOT FOUND";
    notFound.push({ id, count: info.count, hints: Array.from(info.parties) });
  } else {
    identity =
      info.parties.size > 0
        ? Array.from(info.parties).slice(0, 2).join(" / ")
        : "(no API enrichment)";
    status = "?";
  }
  console.log(`${id.padEnd(25)} ${String(info.count).padStart(5)}  ${status.padEnd(12)}  ${identity}`);
}

console.log("");
console.log("=== Summary ===");
console.log(`Distinct primary users in ZIP: ${byUser.size}`);
if (userIndex.size > 0) {
  console.log(`In current Gong workspace:     ${enabled.length}`);
  console.log(`Missing from workspace:        ${notFound.length}`);
  console.log("");
  if (enabled.length > 0) {
    console.log("Ask the Gong admin to enable 'Recording or telephony call import' for:");
    for (const u of enabled) {
      console.log(`  - ${u.name}${u.email ? ` <${u.email}>` : ""}  (id ${u.id}, ${u.count} call${u.count === 1 ? "" : "s"})`);
    }
  }
  if (notFound.length > 0) {
    console.log("");
    console.log("These primaryUserIds are NOT in this workspace — you can't enable permission for them here.");
    console.log("Workaround: pick one enabled user above and use the primaryUser override to redirect those calls.");
    for (const u of notFound) {
      console.log(`  - id ${u.id} (${u.count} call${u.count === 1 ? "" : "s"}) hints: ${u.hints.slice(0, 2).join(" / ") || "(none)"}`);
    }
  }
}
