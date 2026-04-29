#!/usr/bin/env node
// Count Salesloft conversations and break them down by year + recording presence.
// Reads SALESLOFT_API_KEY from .env.local.

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

const apiKey = process.env.SALESLOFT_API_KEY;
if (!apiKey) {
  console.error("Missing SALESLOFT_API_KEY in .env.local");
  process.exit(1);
}
const BASE = "https://api.salesloft.com";
const headers = { Authorization: `Bearer ${apiKey}`, Accept: "application/json" };

// 1) Quick total_count via a 1-row page-1 request.
console.log("Pinging /v2/conversations for total count...");
const probe = await fetch(`${BASE}/v2/conversations?per_page=1&page=1&sort_by=created_at&sort_direction=desc`, { headers });
if (!probe.ok) {
  console.error(`Probe failed: ${probe.status} ${await probe.text()}`);
  process.exit(1);
}
const probeJson = await probe.json();
const paging = probeJson.metadata?.paging || {};
const totalCount = paging.total_count;
const totalPages = paging.total_pages;
console.log(`Total conversations:  ${totalCount ?? "(not reported)"}`);
console.log(`Total pages @ 1/page: ${totalPages ?? "(not reported)"}`);
console.log("");

// Pull a sample and check recording presence
const sample = probeJson.data?.[0];
if (sample) {
  console.log("Sample conversation:");
  console.log(`  id:          ${sample.id}`);
  console.log(`  created_at:  ${sample.created_at}`);
  console.log(`  duration:    ${sample.duration}`);
  console.log(`  has fields:  ${Object.keys(sample).join(", ")}`);
}

// 2) Year breakdown — only worth doing if total is small enough or we want a histogram.
//    We'll page through with per_page=100 and bucket by year.
console.log("");
console.log("Walking all pages (per_page=100) to bucket by year + recording presence...");

const yearCounts = new Map();
const yearWithRecording = new Map();
const yearWithoutRecording = new Map();
const noRecordingHints = { transcribed: 0, withRecording: 0, total: 0 };

let page = 1;
let pulled = 0;
const pageSize = 100;
const startTime = Date.now();

while (true) {
  const url = `${BASE}/v2/conversations?per_page=${pageSize}&page=${page}&sort_by=created_at&sort_direction=desc`;
  const r = await fetch(url, { headers });
  if (r.status === 429) {
    const wait = Number(r.headers.get("retry-after") || 5);
    console.log(`  rate-limited, sleeping ${wait}s`);
    await new Promise((res) => setTimeout(res, wait * 1000));
    continue;
  }
  if (!r.ok) {
    console.error(`Page ${page} failed: ${r.status} ${await r.text()}`);
    break;
  }
  const j = await r.json();
  const rows = j.data || [];
  if (rows.length === 0) break;
  for (const row of rows) {
    const year = (row.created_at || "").slice(0, 4) || "unknown";
    yearCounts.set(year, (yearCounts.get(year) || 0) + 1);
    // recording presence: try a few likely fields
    const hasRecording =
      !!row.recording?.url ||
      !!row.recording_url ||
      !!row.recording ||
      row.has_recording === true ||
      (row.recordings && row.recordings.length > 0);
    if (hasRecording) {
      yearWithRecording.set(year, (yearWithRecording.get(year) || 0) + 1);
      noRecordingHints.withRecording++;
    } else {
      yearWithoutRecording.set(year, (yearWithoutRecording.get(year) || 0) + 1);
    }
    if (row.transcribed_at || row.transcription_id) noRecordingHints.transcribed++;
    noRecordingHints.total++;
  }
  pulled += rows.length;
  process.stdout.write(`  page ${page}: pulled ${pulled} so far\r`);

  const next = j.metadata?.paging?.next_page;
  if (!next) break;
  page = next;
  if (page > 2000) break; // safety
}

const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
console.log("");
console.log(`Walked ${pulled} conversations in ${elapsed}s`);
console.log("");
console.log("By year:");
const sortedYears = Array.from(yearCounts.keys()).sort().reverse();
console.log("year  total  with-recording  without");
console.log("----  -----  --------------  -------");
for (const y of sortedYears) {
  const t = yearCounts.get(y) || 0;
  const w = yearWithRecording.get(y) || 0;
  const wo = yearWithoutRecording.get(y) || 0;
  console.log(`${y}   ${String(t).padStart(5)}   ${String(w).padStart(13)}    ${String(wo).padStart(5)}`);
}

console.log("");
console.log("=== Summary ===");
console.log(`Total conversations:        ${pulled}`);
console.log(`Likely have recording:      ${noRecordingHints.withRecording}`);
console.log(`No recording field on list: ${noRecordingHints.total - noRecordingHints.withRecording}`);
console.log("(note: 'has-recording' is best-effort from list-view fields; the actual recording URL is fetched per-call from /v2/conversations/:id/recording)");

const out = {
  generatedAt: new Date().toISOString(),
  totalCount,
  pulled,
  byYear: Object.fromEntries(sortedYears.map((y) => [y, {
    total: yearCounts.get(y),
    withRecording: yearWithRecording.get(y) || 0,
    withoutRecording: yearWithoutRecording.get(y) || 0,
  }])),
};
await fs.writeFile(path.resolve("./scripts/salesloft-count-result.json"), JSON.stringify(out, null, 2));
console.log("");
console.log("Detailed JSON written to scripts/salesloft-count-result.json");
