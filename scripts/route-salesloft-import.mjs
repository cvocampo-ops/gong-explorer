#!/usr/bin/env node
// Routing analysis: for ALL Salesloft conversations, decide which Gong user
// each call would be attributed to. No uploads. Pulls /v2/users from both
// Salesloft and Gong once, then maps via owner_id → SL email → Gong user.

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
const slH = { Authorization: `Bearer ${SLK}`, Accept: "application/json" };
const gAuth = "Basic " + Buffer.from(`${GAK}:${GAS}`).toString("base64");

const args = process.argv.slice(2);
const fallbackEmail = (args[args.indexOf("--fallback") + 1] || "ben.mcwilliams@2x.marketing").toLowerCase();

// 1. Pull Gong user index
const gongByEmail = new Map();
{
  let cursor;
  do {
    const url = new URL(`${GBASE}/v2/users`);
    if (cursor) url.searchParams.set("cursor", cursor);
    const r = await fetch(url, { headers: { Authorization: gAuth } });
    const j = await r.json();
    for (const u of j.users || []) {
      if (u.emailAddress) {
        gongByEmail.set(u.emailAddress.toLowerCase(), {
          id: u.id,
          name: [u.firstName, u.lastName].filter(Boolean).join(" ") || u.emailAddress,
          email: u.emailAddress,
          active: u.active,
        });
      }
    }
    cursor = j.records?.cursor;
  } while (cursor);
}
console.log(`Gong users: ${gongByEmail.size}`);

const fallback = gongByEmail.get(fallbackEmail);
if (!fallback) {
  console.error(`Fallback ${fallbackEmail} not found in Gong`);
  process.exit(1);
}

// 2. Pull SL user index (id+guid → email)
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
console.log(`Salesloft users: ${slById.size}`);
console.log("");

// 3. Walk all SL conversations
const buckets = {
  activeOwner: new Map(),    // gongUserId → count
  inactiveOwner: new Map(),  // slEmail → count (will fall back)
  unknownOwner: new Map(),   // slEmail or "no email" → count
};
const callsByYear = new Map();
let total = 0;
{
  let page = 1;
  while (true) {
    const r = await fetch(`https://api.salesloft.com/v2/conversations?per_page=100&page=${page}&sort_by=created_at&sort_direction=desc`, { headers: slH });
    const j = await r.json();
    const calls = j.data || [];
    for (const c of calls) {
      total++;
      const year = (c.created_at || "").slice(0, 4) || "?";
      callsByYear.set(year, (callsByYear.get(year) || 0) + 1);

      const slUser = c.owner_id ? slByGuid.get(c.owner_id) || slById.get(String(c.owner_id)) : null;
      const slEmail = (slUser?.email || "").toLowerCase();

      if (slEmail) {
        const gongUser = gongByEmail.get(slEmail);
        if (gongUser && gongUser.active !== false) {
          const k = gongUser.email;
          buckets.activeOwner.set(k, (buckets.activeOwner.get(k) || 0) + 1);
        } else if (gongUser) {
          buckets.inactiveOwner.set(slEmail, (buckets.inactiveOwner.get(slEmail) || 0) + 1);
        } else {
          buckets.unknownOwner.set(slEmail, (buckets.unknownOwner.get(slEmail) || 0) + 1);
        }
      } else {
        buckets.unknownOwner.set("(no email on SL user)", (buckets.unknownOwner.get("(no email on SL user)") || 0) + 1);
      }
    }
    if (!j.metadata?.paging?.next_page) break;
    page = j.metadata.paging.next_page;
  }
}

console.log(`Total Salesloft conversations: ${total}`);
console.log("");
console.log("By year:");
for (const [y, n] of Array.from(callsByYear).sort()) console.log(`  ${y}: ${n}`);
console.log("");

const sumActive = Array.from(buckets.activeOwner.values()).reduce((a, b) => a + b, 0);
const sumInactive = Array.from(buckets.inactiveOwner.values()).reduce((a, b) => a + b, 0);
const sumUnknown = Array.from(buckets.unknownOwner.values()).reduce((a, b) => a + b, 0);

console.log(`✓ Native owner active in Gong (kept):     ${sumActive}`);
console.log(`✗ Native owner INACTIVE in Gong → ${fallbackEmail}:  ${sumInactive}`);
console.log(`? Owner not in Gong → ${fallbackEmail}:                ${sumUnknown}`);
console.log("");

if (buckets.activeOwner.size) {
  console.log("Calls that would keep their native owner:");
  for (const [email, n] of Array.from(buckets.activeOwner).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${String(n).padStart(4)}  ${email}`);
  }
  console.log("");
}
if (buckets.inactiveOwner.size) {
  console.log("Calls whose owner is INACTIVE in Gong (forced to fallback):");
  for (const [email, n] of Array.from(buckets.inactiveOwner).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${String(n).padStart(4)}  ${email}`);
  }
  console.log("");
}
if (buckets.unknownOwner.size) {
  console.log("Calls whose SL owner has no Gong account at all (forced to fallback):");
  for (const [email, n] of Array.from(buckets.unknownOwner).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${String(n).padStart(4)}  ${email}`);
  }
}
