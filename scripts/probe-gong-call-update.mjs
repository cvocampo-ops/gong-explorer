#!/usr/bin/env node
// One-shot probe: is there a Gong API that updates `primaryUser` on a call
// that's already been created? If yes, we can backfill the existing
// Ben-owned imports without delete+reimport (which would lose comments,
// tags, and any other post-import annotations).
//
// This script does NOT batch-mutate. It runs a few candidate requests
// against one --callId with one --primary user and prints status+body
// for each so you can decide whether any endpoint accepts the update.
// Confirm response in Gong UI afterward before declaring victory.
//
// Usage:
//   node scripts/probe-gong-call-update.mjs --callId 1234567 --primary sarah@2x.marketing
//   node scripts/probe-gong-call-update.mjs --callId 1234567 --primary 9876543210     # accept userId directly

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

const GAK = process.env.GONG_ACCESS_KEY;
const GAS = process.env.GONG_ACCESS_KEY_SECRET;
const GBASE = (process.env.GONG_BASE_URL || "https://api.gong.io").replace(/\/+$/, "");
const gAuth = "Basic " + Buffer.from(`${GAK}:${GAS}`).toString("base64");

const args = process.argv.slice(2);
const arg = (f, d) => { const i = args.indexOf(f); return i >= 0 ? args[i + 1] : d; };

const callId = arg("--callId");
const primaryArg = arg("--primary");
if (!callId || !primaryArg) {
  console.error("Usage: node scripts/probe-gong-call-update.mjs --callId <id> --primary <email|userId>");
  process.exit(1);
}

// Resolve --primary to a Gong userId (accept email or raw userId).
async function resolvePrimaryUser(input) {
  if (/^\d+$/.test(input)) return { id: input, email: "(by userId)" };
  const wanted = input.toLowerCase();
  let cursor;
  do {
    const url = new URL(`${GBASE}/v2/users`);
    if (cursor) url.searchParams.set("cursor", cursor);
    const r = await fetch(url, { headers: { Authorization: gAuth } });
    if (!r.ok) throw new Error(`GET /v2/users → ${r.status}`);
    const j = await r.json();
    for (const u of j.users || []) {
      if (u.emailAddress && u.emailAddress.toLowerCase() === wanted) {
        if (u.active === false) throw new Error(`Gong user ${input} is inactive`);
        return { id: u.id, email: u.emailAddress };
      }
    }
    cursor = j.records?.cursor;
  } while (cursor);
  throw new Error(`Gong user not found: ${input}`);
}

const primaryUser = await resolvePrimaryUser(primaryArg);
console.log(`Target callId:   ${callId}`);
console.log(`New primaryUser: ${primaryUser.email} (id=${primaryUser.id})`);
console.log(`Tenant:          ${GBASE}`);
console.log("");

async function probe(label, method, urlPath, body) {
  const url = `${GBASE}${urlPath}`;
  const init = { method, headers: { Authorization: gAuth } };
  if (body !== undefined) {
    init.headers["Content-Type"] = "application/json";
    init.body = JSON.stringify(body);
  }
  console.log(`── ${label}`);
  console.log(`   ${method} ${url}`);
  if (body !== undefined) console.log(`   body: ${JSON.stringify(body)}`);
  try {
    const r = await fetch(url, init);
    const text = await r.text();
    const status = r.status;
    const verdict =
      status >= 200 && status < 300 ? "✓ ACCEPTED" :
      status === 404 ? "✗ endpoint does not exist" :
      status === 405 ? "✗ method not allowed" :
      status === 400 ? "? rejected (bad payload — try alternate shape)" :
      status === 401 ? "✗ auth failed" :
      status === 403 ? "✗ forbidden (perms or wrong scope)" :
      `? status ${status}`;
    console.log(`   → ${status}  ${verdict}`);
    if (text) console.log(`   body: ${text.slice(0, 400)}`);
  } catch (err) {
    console.log(`   → network error: ${err.message}`);
  }
  console.log("");
}

// Candidate 1: REST-idiomatic update on the call resource.
await probe(
  "Probe 1: PUT /v2/calls/{id} with { primaryUser }",
  "PUT",
  `/v2/calls/${encodeURIComponent(callId)}`,
  { primaryUser: primaryUser.id }
);

// Candidate 2: same path but PATCH (some APIs use PATCH instead of PUT).
await probe(
  "Probe 2: PATCH /v2/calls/{id} with { primaryUser }",
  "PATCH",
  `/v2/calls/${encodeURIComponent(callId)}`,
  { primaryUser: primaryUser.id }
);

// Candidate 3: Gong's "manage" endpoint, common for bulk mutations.
await probe(
  "Probe 3: POST /v2/calls/manage with { calls: [{ callId, primaryUser }] }",
  "POST",
  `/v2/calls/manage`,
  { calls: [{ callId, primaryUser: primaryUser.id }] }
);

// Candidate 4: alternate shape for /manage.
await probe(
  "Probe 4: POST /v2/calls/manage with { callIds, primaryUser }",
  "POST",
  `/v2/calls/manage`,
  { callIds: [callId], primaryUser: primaryUser.id }
);

// Candidate 5: per-call action endpoint.
await probe(
  "Probe 5: PUT /v2/calls/{id}/owner",
  "PUT",
  `/v2/calls/${encodeURIComponent(callId)}/owner`,
  { primaryUser: primaryUser.id }
);

console.log("Done. Review responses above:");
console.log("  • Any 2xx → that endpoint works; we can build a backfill script.");
console.log("  • All 404/405 → no documented update path; choice is leave-as-is vs delete+reimport.");
console.log("  • Any 400 → endpoint exists but payload was wrong; check the body for the expected schema.");
