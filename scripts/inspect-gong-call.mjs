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

const callId = process.argv[2];
if (!callId) {
  console.error("Usage: node scripts/inspect-gong-call.mjs <callId>");
  process.exit(1);
}

const r = await fetch(`${baseUrl}/v2/calls/extensive`, {
  method: "POST",
  headers: { Authorization: auth, "Content-Type": "application/json" },
  body: JSON.stringify({
    filter: { callIds: [callId] },
    contentSelector: { exposedFields: { parties: true, media: true } },
  }),
});
if (!r.ok) {
  console.error(`HTTP ${r.status}: ${await r.text()}`);
  process.exit(1);
}
const j = await r.json();
console.log(JSON.stringify(j.calls?.[0]?.metaData ?? j, null, 2));
