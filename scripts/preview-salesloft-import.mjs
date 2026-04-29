#!/usr/bin/env node
// Preview what Salesloft → Gong imports will look like, WITHOUT uploading.
// Shows the FULL parties array (all attendees + invitees) so you can verify
// participant data is preserved.
//
// Usage:
//   node scripts/preview-salesloft-import.mjs                                    # 5 most recent
//   node scripts/preview-salesloft-import.mjs --limit 10
//   node scripts/preview-salesloft-import.mjs --primary ben.mcwilliams@2x.marketing

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
const arg = (f, d) => {
  const i = args.indexOf(f);
  return i >= 0 ? args[i + 1] : d;
};
const limit = Number(arg("--limit", "5"));
const primaryEmail = arg("--primary", "ben.mcwilliams@2x.marketing").toLowerCase();

// --- Pull Gong user index ---
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

const primaryUser = gongByEmail.get(primaryEmail);
if (!primaryUser || primaryUser.active === false) {
  console.error(`Primary user "${primaryEmail}" not found or inactive in Gong`);
  process.exit(1);
}

// --- Date formatting ---
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
function ordinal(n) {
  if (n >= 11 && n <= 13) return `${n}th`;
  switch (n % 10) { case 1: return `${n}st`; case 2: return `${n}nd`; case 3: return `${n}rd`; default: return `${n}th`; }
}
function prettyDate(d) { return `${MONTHS[d.getMonth()]} ${ordinal(d.getDate())} ${d.getFullYear()}`; }
const importTagDate = prettyDate(new Date());
const importTag = `Import · ${importTagDate}`;

function normalizeStarted(c) {
  const raw = c.started_recording_at ?? c.event_start_date ?? c.created_at;
  if (typeof raw === "number") return new Date(raw < 1e11 ? raw * 1000 : raw).toISOString();
  return new Date(raw ?? Date.now()).toISOString();
}

// Slugify a name into the form we'd expect in an email username
// ("Mark Lutz" → "mark.lutz"). Used to merge an attendee that has only
// a name with an invitee that has only an email like mark.lutz@gong.io.
function nameSlug(name) {
  return name
    .toLowerCase()
    .replace(/\([^)]*\)/g, "")        // strip parentheticals like "(OBF)"
    .replace(/[^a-z0-9 ]+/g, " ")
    .trim()
    .replace(/\s+/g, ".");
}
function emailMatchesName(email, name) {
  if (!email || !name) return false;
  const user = email.split("@")[0].toLowerCase().replace(/\+.*$/, "");
  const slug = nameSlug(name);
  if (!slug) return false;
  if (user === slug) return true;                      // mark.lutz === mark.lutz
  const [first] = slug.split(".");
  if (first && user === first) return true;            // jessica === jessica
  return false;
}

// Build the Gong `parties` array from SL attendees + invitees, resolving
// emails to Gong userIds where possible. The primaryUser is always the
// first party. Same-person duplicates (e.g. attendee with name only and
// invitee with email only) are merged by name-slug↔email-username match.
function buildParties(attendees, invitees, primary) {
  // Stage 1: collect every raw entry from attendees + invitees
  const raw = [];
  raw.push({ userId: primary.id, affiliation: "Internal", _primary: true });

  for (const a of attendees || []) {
    const email = (a.email || "").trim().toLowerCase();
    const name = (a.full_name || "").trim() || undefined;
    const aff = a.is_internal ? "Internal" : "External";
    raw.push({ name, email, affiliation: aff });
  }
  for (const i of invitees || []) {
    const email = (i.email || "").trim().toLowerCase();
    const name = (i.full_name || "").trim() || undefined;
    if (!email && !name) continue;
    // Heuristic: known internal domains
    const internal = email.endsWith("@outboundfunnel.com") || email.endsWith("@2x.marketing");
    raw.push({ name, email, affiliation: internal ? "Internal" : "External" });
  }

  // Stage 2: merge — keys are { resolvedGongUserId | email | nameSlug }.
  // We accumulate name + email from any matching entry, and prefer
  // "Internal" if any source said internal.
  const merged = []; // each: { userId?, name?, email?, affiliation }

  function findIndex(entry) {
    for (let i = 0; i < merged.length; i++) {
      const m = merged[i];
      if (entry.userId && m.userId === entry.userId) return i;
      if (entry.email && m.email === entry.email) return i;
      // name-slug ↔ email-username crossover
      if (entry.email && m.name && emailMatchesName(entry.email, m.name)) return i;
      if (entry.name && m.email && emailMatchesName(m.email, entry.name)) return i;
      // exact same name
      if (entry.name && m.name && nameSlug(entry.name) === nameSlug(m.name)) return i;
    }
    return -1;
  }

  for (const r of raw) {
    let entry = { ...r };
    delete entry._primary;
    // Resolve email to a Gong user id if we can — that gives us much better
    // attribution and lets this entry merge with existing ones via userId.
    if (!entry.userId && entry.email) {
      const gu = gongByEmail.get(entry.email);
      if (gu && gu.active !== false) {
        entry = { userId: gu.id, affiliation: "Internal" };
      }
    }
    const idx = findIndex(entry);
    if (idx === -1) {
      merged.push(entry);
    } else {
      const m = merged[idx];
      if (entry.userId && !m.userId) m.userId = entry.userId;
      if (entry.email && !m.email) m.email = entry.email;
      if (entry.name && !m.name) m.name = entry.name;
      // Internal beats External (a SL "External" sometimes mislabels colleagues)
      if (entry.affiliation === "Internal") m.affiliation = "Internal";
    }
  }

  // Stage 3: shape into Gong's expected format
  return merged.map((m) => {
    if (m.userId) return { userId: m.userId, affiliation: "Internal" };
    return {
      ...(m.name && { name: m.name }),
      ...(m.email && { emailAddress: m.email }),
      affiliation: m.affiliation || "Unknown",
    };
  });
}

async function slGet(p) {
  const r = await fetch(`https://api.salesloft.com${p}`, { headers: slH });
  if (!r.ok) throw new Error(`SL ${p} → ${r.status} ${await r.text()}`);
  return r.json();
}

console.log(`Primary user: ${primaryUser.name} <${primaryUser.email}>`);
console.log(`Import tag:   "${importTag}"`);
console.log(`Gong users indexed: ${gongByEmail.size}`);
console.log("");

const list = await slGet(`/v2/conversations?per_page=${limit}&page=1&sort_by=created_at&sort_direction=desc`);
const convs = list.data || [];
console.log(`=== Preview of ${convs.length} call(s) — NO UPLOADS ===\n`);

let i = 0;
for (const c of convs) {
  i++;
  const ext = await slGet(`/v2/conversations/${c.id}/extensive`);
  const ec = ext.data || c;
  const started = normalizeStarted(ec);
  const durationSec = Math.max(1, Math.round((ec.duration ?? 0) / 1000));
  const baseTitle = ec.title || `Salesloft call ${ec.id}`;
  const finalTitle = `${baseTitle} · ${importTag}`;
  const parties = buildParties(ec.attendees || [], ec.invitees || [], primaryUser);

  const metadata = {
    clientUniqueId: `salesloft-${ec.id}`,
    title: finalTitle,
    actualStart: started,
    duration: durationSec,
    direction: "Conference",
    primaryUser: primaryUser.id,
    parties,
    customData: `salesloft-import:${new Date().toISOString().slice(0, 10)}`,
    ...(ec.language_code && { languageCode: ec.language_code }),
  };

  console.log(`──── [${i}/${convs.length}] ────────────────────────────────────────`);
  console.log(`Salesloft id:     ${ec.id}`);
  console.log(`Original title:   "${baseTitle}"`);
  console.log(`Final title:      "${finalTitle}"`);
  console.log(`Date:             ${prettyDate(new Date(started))}  (${started})`);
  console.log(`Duration:         ${durationSec}s  (${(durationSec / 60).toFixed(1)} min)`);
  console.log(`SL owner:         ${ec.owner_email || "(none)"}`);
  console.log("");
  console.log(`Parties (${parties.length}):`);
  for (const p of parties) {
    if (p.userId === primaryUser.id) {
      console.log(`  ★ Gong user  ${primaryUser.name} <${primaryUser.email}>  [PRIMARY/Internal]`);
    } else if (p.userId) {
      // resolved to a Gong user other than primary
      const u = Array.from(gongByEmail.values()).find((x) => x.id === p.userId);
      console.log(`  ✓ Gong user  ${u?.name || p.userId} <${u?.email || ""}>  [Internal]`);
    } else {
      const tag = p.affiliation === "Internal" ? "Internal (no Gong account)" : "External";
      console.log(`  ○ Named      ${p.name || "(no name)"}  <${p.emailAddress || ""}>  [${tag}]`);
    }
  }
  console.log("");
  console.log(`POST /v2/calls payload:`);
  console.log(JSON.stringify(metadata, null, 2));
  console.log("");
}

console.log("================================================================");
console.log(`(No uploads. Re-run with the bulk script when ready.)`);
