#!/usr/bin/env node
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

const access = process.env.GONG_ACCESS_KEY;
const secret = process.env.GONG_ACCESS_KEY_SECRET;
const baseUrl = (process.env.GONG_BASE_URL || "https://api.gong.io").replace(/\/+$/, "");
const auth = "Basic " + Buffer.from(`${access}:${secret}`).toString("base64");

const queries = process.argv.slice(2).map((s) => s.toLowerCase());
if (queries.length === 0) {
  console.error("Usage: node scripts/find-gong-user.mjs <email-or-name> [more...]");
  process.exit(1);
}

const matches = [];
let cursor;
let pages = 0;
let total = 0;
do {
  const url = new URL(`${baseUrl}/v2/users`);
  if (cursor) url.searchParams.set("cursor", cursor);
  const r = await fetch(url, { headers: { Authorization: auth } });
  if (!r.ok) {
    console.error(`Failed: ${r.status} ${await r.text()}`);
    process.exit(1);
  }
  const data = await r.json();
  for (const u of data.users || []) {
    total++;
    const blob = JSON.stringify(u).toLowerCase();
    if (queries.some((q) => blob.includes(q))) matches.push(u);
  }
  cursor = data.records?.cursor;
  pages++;
} while (cursor && pages < 200);

console.log(`Scanned ${total} users across ${pages} page(s).`);
console.log(`Matches for [${queries.join(", ")}]: ${matches.length}\n`);
for (const u of matches) {
  const name = [u.firstName, u.lastName].filter(Boolean).join(" ") || "(no name)";
  console.log(`- ${name}`);
  console.log(`    id:      ${u.id}`);
  console.log(`    email:   ${u.emailAddress}`);
  console.log(`    active:  ${u.active}`);
  if (u.title) console.log(`    title:   ${u.title}`);
  console.log("");
}
