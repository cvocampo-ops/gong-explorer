#!/usr/bin/env node
// Scope which Gong users would need "Recording or telephony call import" enabled.
//
// Reads creds from .env.local. Pulls /v2/users and runs a call census via
// /v2/calls/extensive across a configurable date window, grouping by primaryUserId.
//
// Usage:
//   node scripts/scope-import-users.mjs                # last 365 days
//   node scripts/scope-import-users.mjs --days 730     # last 2 years
//   node scripts/scope-import-users.mjs --from 2023-01-01 --to 2026-04-29

import fs from "node:fs/promises";
import path from "node:path";

// --- Load .env.local -----------------------------------------------------
const envPath = path.resolve("./.env.local");
const envText = await fs.readFile(envPath, "utf8");
for (const line of envText.split("\n")) {
  const m = line.match(/^([A-Z_]+)=(.*)$/);
  if (!m) continue;
  let v = m[2];
  if (v.startsWith('"') && v.endsWith('"')) v = v.slice(1, -1);
  if (!process.env[m[1]]) process.env[m[1]] = v;
}

const accessKey = process.env.GONG_ACCESS_KEY;
const accessSecret = process.env.GONG_ACCESS_KEY_SECRET;
const baseUrl = (process.env.GONG_BASE_URL || "https://api.gong.io").replace(/\/+$/, "");
if (!accessKey || !accessSecret) {
  console.error("Missing GONG_ACCESS_KEY / GONG_ACCESS_KEY_SECRET in .env.local");
  process.exit(1);
}
const auth = "Basic " + Buffer.from(`${accessKey}:${accessSecret}`).toString("base64");

// --- Args ----------------------------------------------------------------
const args = process.argv.slice(2);
function arg(flag) {
  const i = args.indexOf(flag);
  return i >= 0 ? args[i + 1] : undefined;
}
const days = Number(arg("--days") || 365);
const fromDate = arg("--from") || new Date(Date.now() - days * 86400_000).toISOString();
const toDate = arg("--to") || new Date().toISOString();

console.log(`Tenant:  ${baseUrl}`);
console.log(`Window:  ${fromDate}  →  ${toDate}`);
console.log("");

// --- Pull all users ------------------------------------------------------
console.log("Fetching /v2/users ...");
const userIndex = new Map();
{
  let cursor;
  let pages = 0;
  do {
    const url = new URL(`${baseUrl}/v2/users`);
    if (cursor) url.searchParams.set("cursor", cursor);
    const r = await fetch(url, { headers: { Authorization: auth } });
    if (!r.ok) {
      console.error(`/v2/users failed: ${r.status} ${await r.text()}`);
      break;
    }
    const data = await r.json();
    for (const u of data.users || []) {
      userIndex.set(u.id, {
        id: u.id,
        name: [u.firstName, u.lastName].filter(Boolean).join(" ") || u.emailAddress || u.id,
        email: u.emailAddress,
        active: u.active,
        title: u.title,
        managerId: u.managerId,
      });
    }
    cursor = data.records?.cursor;
    pages++;
  } while (cursor && pages < 200);
  console.log(`  → ${userIndex.size} users across ${pages} page(s)`);
}

// --- Census calls by primaryUserId --------------------------------------
console.log("");
console.log("Running call census via /v2/calls/extensive ...");
const byPrimary = new Map(); // primaryUserId -> count
const sampleByPrimary = new Map(); // -> [{ id, title, started }]
let totalCalls = 0;
{
  const payload = {
    filter: { fromDateTime: fromDate, toDateTime: toDate },
    contentSelector: { exposedFields: { parties: true } },
  };
  let cursor;
  let pages = 0;
  do {
    const body = cursor ? { ...payload, cursor } : payload;
    const r = await fetch(`${baseUrl}/v2/calls/extensive`, {
      method: "POST",
      headers: { Authorization: auth, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!r.ok) {
      console.error(`/v2/calls/extensive failed (page ${pages + 1}): ${r.status} ${await r.text()}`);
      break;
    }
    const data = await r.json();
    const calls = data.calls || [];
    totalCalls += calls.length;
    for (const c of calls) {
      const pid = c.metaData?.primaryUserId;
      if (!pid) continue;
      byPrimary.set(pid, (byPrimary.get(pid) || 0) + 1);
      const arr = sampleByPrimary.get(pid) || [];
      if (arr.length < 2) {
        arr.push({
          id: c.metaData?.id,
          title: c.metaData?.title,
          started: c.metaData?.started,
        });
        sampleByPrimary.set(pid, arr);
      }
    }
    cursor = data.records?.cursor;
    pages++;
    process.stdout.write(`  pages: ${pages}   calls so far: ${totalCalls}\r`);
  } while (cursor && pages < 500);
  console.log("");
  console.log(`  → ${totalCalls} calls scanned, ${byPrimary.size} distinct primaryUserIds`);
}

// --- Render --------------------------------------------------------------
console.log("");
const rows = Array.from(byPrimary.entries())
  .map(([id, count]) => {
    const u = userIndex.get(id);
    return {
      id,
      count,
      name: u?.name || "(NOT IN USER LIST)",
      email: u?.email,
      active: u?.active,
      inWorkspace: !!u,
    };
  })
  .sort((a, b) => b.count - a.count);

console.log("primaryUserId             calls  status         identity");
console.log("------------------------- -----  -------------  ------------------------------------");
for (const r of rows) {
  let status;
  if (!r.inWorkspace) status = "NOT FOUND";
  else if (r.active === false) status = "INACTIVE";
  else status = "active";
  const identity = r.email ? `${r.name} <${r.email}>` : r.name;
  console.log(
    `${r.id.padEnd(25)} ${String(r.count).padStart(5)}  ${status.padEnd(13)}  ${identity}`
  );
}

console.log("");
console.log("=== Recommendation ===");
const active = rows.filter((r) => r.inWorkspace && r.active !== false);
const inactive = rows.filter((r) => r.inWorkspace && r.active === false);
const missing = rows.filter((r) => !r.inWorkspace);
console.log(`Distinct call owners in window:    ${rows.length}`);
console.log(`  Active in workspace:             ${active.length}`);
console.log(`  Inactive in workspace:           ${inactive.length}`);
console.log(`  Not in /v2/users (deleted?):     ${missing.length}`);
console.log("");
console.log("Option A — enable for everyone who currently appears as a primary user:");
for (const r of active) {
  console.log(`  - ${r.name}${r.email ? ` <${r.email}>` : ""}  (id ${r.id}, ${r.count} call${r.count === 1 ? "" : "s"})`);
}
if (inactive.length || missing.length) {
  console.log("");
  console.log("These IDs CAN'T have permission enabled (inactive/deleted):");
  for (const r of [...inactive, ...missing]) {
    console.log(`  - id ${r.id} (${r.count} call${r.count === 1 ? "" : "s"})${r.name ? ` ${r.name}` : ""}`);
  }
  console.log("→ Calls owned by these users would still 409 unless you use a primaryUser override.");
}
console.log("");
console.log("Option B — enable for ONE designated import user, override every import to that user.");
console.log("  Pick one active user above; admin enables import permission only for them; the");
console.log("  ZIP UI's primaryUser override (or sourceUrl JSON body) routes everything there.");

// --- Write a JSON dump for further use ----------------------------------
const out = {
  generatedAt: new Date().toISOString(),
  baseUrl,
  window: { fromDate, toDate },
  totalUsersInWorkspace: userIndex.size,
  totalCallsScanned: totalCalls,
  distinctPrimaryUsers: rows.length,
  rows: rows.map((r) => ({ ...r, sample: sampleByPrimary.get(r.id) })),
};
const outPath = path.resolve("./scripts/scope-result.json");
await fs.writeFile(outPath, JSON.stringify(out, null, 2));
console.log("");
console.log(`Detailed JSON written to ${path.relative(process.cwd(), outPath)}`);
