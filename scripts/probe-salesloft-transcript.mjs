#!/usr/bin/env node
// scripts/probe-salesloft-transcript.mjs
// Usage:
//   SALESLOFT_API_KEY=... node scripts/probe-salesloft-transcript.mjs
//   SALESLOFT_API_KEY=... CONVERSATION_ID=<id> node scripts/probe-salesloft-transcript.mjs
//
// Discovers:
//   (a) Which field on /extensive links the conversation to its transcription
//   (b) Shape of /v2/transcriptions/:id/sentences
//   (c) Whether /extensive returns summary, action_items, key_moments directly

const apiKey = process.env.SALESLOFT_API_KEY;
const envConvId = process.env.CONVERSATION_ID;

if (!apiKey) {
  console.error("ERROR: SALESLOFT_API_KEY env var is required");
  process.exit(1);
}

const BASE_URL = "https://api.salesloft.com";
const headers = {
  Authorization: `Bearer ${apiKey}`,
  Accept: "application/json",
};

function truncate(str, maxBytes = 4096) {
  if (str.length <= maxBytes) return str;
  return str.slice(0, maxBytes) + `\n... [truncated at ${maxBytes} chars, total ${str.length}]`;
}

async function probe() {
  let conversationId = envConvId;

  // ─── Step 1-2: Auto-pick a conversation ─────────────────────────────────────
  if (!conversationId) {
    console.log("=== Step 1: GET /v2/conversations?per_page=10&sort_by=created_at&sort_direction=desc");
    const listUrl = `${BASE_URL}/v2/conversations?per_page=10&sort_by=created_at&sort_direction=desc`;
    const listResp = await fetch(listUrl, { headers });
    console.log("  status:", listResp.status);

    if (!listResp.ok) {
      const body = await listResp.text();
      console.error("  ERROR listing conversations:", body);
      process.exit(1);
    }

    const listBody = await listResp.json();
    const conversations = listBody?.data ?? [];
    console.log(`  total conversations returned: ${conversations.length}`);

    if (conversations.length === 0) {
      console.error("  ERROR: No conversations returned — check API key permissions");
      process.exit(1);
    }

    // Step 2: Pick first one with recording_url, or just the first one
    const withRecording = conversations.find((c) => c.recording_url);
    const chosen = withRecording ?? conversations[0];
    conversationId = String(chosen.id);

    console.log(`\n=== Step 2: Chosen conversation`);
    console.log(`  id: ${conversationId}`);
    console.log(`  has recording_url: ${!!chosen.recording_url}`);
    console.log(`  created_at: ${chosen.created_at ?? "(not present)"}`);
    console.log(`  title/subject: ${chosen.title ?? chosen.subject ?? "(none)"}`);
    console.log(`  top-level keys on list entry: ${Object.keys(chosen).join(", ")}`);
  } else {
    console.log(`=== Using CONVERSATION_ID from env: ${conversationId}`);
  }

  // ─── Step 4: GET /v2/conversations/:id/extensive ─────────────────────────────
  console.log(`\n=== Step 4: GET /v2/conversations/${conversationId}/extensive`);
  const extUrl = `${BASE_URL}/v2/conversations/${encodeURIComponent(conversationId)}/extensive`;
  const extResp = await fetch(extUrl, { headers });
  console.log("  status:", extResp.status);

  const extBody = await extResp.json();

  if (!extResp.ok) {
    console.error("  ERROR body:", JSON.stringify(extBody, null, 2));
    console.log("\n  (Continuing to try /v2/transcriptions list regardless...)");
  } else {
    const data = extBody?.data ?? extBody;
    const topLevelKeys = Object.keys(data);
    console.log("  top-level keys on data:", topLevelKeys.join(", "));

    // Identify transcript-related fields
    const transcriptKeys = topLevelKeys.filter((k) => /transcript/i.test(k));
    console.log("  transcript-related keys:", transcriptKeys.length > 0 ? transcriptKeys.join(", ") : "(none)");

    // Check for summary, action_items, key_moments
    const aiFields = ["summary", "action_items", "key_moments"];
    for (const field of aiFields) {
      const present = field in data;
      const val = data[field];
      const valPreview =
        val === null
          ? "null"
          : val === undefined
          ? "undefined"
          : Array.isArray(val)
          ? `Array(${val.length})`
          : typeof val === "string"
          ? `string(${val.length} chars)`
          : typeof val === "object"
          ? `object: ${JSON.stringify(val).slice(0, 100)}`
          : String(val);
      console.log(`  ${field}: ${present ? "PRESENT" : "ABSENT"} — ${valPreview}`);
    }

    // Show transcript-related field values
    for (const key of transcriptKeys) {
      const val = data[key];
      const valPreview =
        val === null || val === undefined
          ? String(val)
          : Array.isArray(val)
          ? JSON.stringify(val).slice(0, 200)
          : typeof val === "object"
          ? JSON.stringify(val).slice(0, 200)
          : String(val);
      console.log(`  [transcript field] ${key}:`, valPreview);
    }

    console.log("\n  Full /extensive body (truncated to 4kB):");
    console.log(truncate(JSON.stringify(extBody, null, 2)));
  }

  // ─── Step 5: GET /v2/transcriptions?per_page=5 ───────────────────────────────
  console.log("\n=== Step 5: GET /v2/transcriptions?per_page=5");
  const transListUrl = `${BASE_URL}/v2/transcriptions?per_page=5`;
  const transListResp = await fetch(transListUrl, { headers });
  console.log("  status:", transListResp.status);

  const transListBody = await transListResp.json();

  if (!transListResp.ok) {
    console.log("  ERROR body:", JSON.stringify(transListBody, null, 2));
  } else {
    const entries = transListBody?.data ?? [];
    console.log(`  total entries returned: ${entries.length}`);
    if (entries.length > 0) {
      console.log("  sample entry (first one):");
      console.log(JSON.stringify(entries[0], null, 2));
      console.log("  top-level keys on sample entry:", Object.keys(entries[0]).join(", "));
    } else {
      console.log("  (no transcription entries in account)");
    }
  }

  // ─── Step 6: Discover transcription id and fetch sentences ───────────────────
  // Try to find a transcription id from /extensive first, then fall back to list
  let transcriptionId = null;
  let transcriptionIdSource = null;

  // Check /extensive data for transcription-related fields
  if (extResp.ok) {
    const data = extBody?.data ?? extBody;
    const transcriptKeys = Object.keys(data).filter((k) => /transcript/i.test(k));

    for (const key of transcriptKeys) {
      const val = data[key];
      if (val && (typeof val === "string" || typeof val === "number")) {
        transcriptionId = String(val);
        transcriptionIdSource = `/extensive field: ${key}`;
        break;
      }
      // Could be an array of objects with an id field
      if (Array.isArray(val) && val.length > 0 && val[0]?.id !== undefined) {
        transcriptionId = String(val[0].id);
        transcriptionIdSource = `/extensive field: ${key}[0].id`;
        break;
      }
      // Could be a nested object with an id field
      if (val && typeof val === "object" && !Array.isArray(val) && val.id !== undefined) {
        transcriptionId = String(val.id);
        transcriptionIdSource = `/extensive field: ${key}.id`;
        break;
      }
    }
  }

  // Fall back to /transcriptions list
  if (!transcriptionId && transListResp.ok) {
    const entries = transListBody?.data ?? [];
    if (entries.length > 0 && entries[0]?.id !== undefined) {
      transcriptionId = String(entries[0].id);
      transcriptionIdSource = "/v2/transcriptions list entry [0].id";
    }
  }

  console.log(`\n=== Transcription id discovery`);
  console.log(`  transcription id: ${transcriptionId ?? "(not found)"}`);
  console.log(`  source: ${transcriptionIdSource ?? "(none)"}`);

  if (!transcriptionId) {
    console.log("\n=== Step 6: Skipped — no transcription id discoverable");
    return;
  }

  // Step 6: Fetch sentences
  console.log(`\n=== Step 6: GET /v2/transcriptions/${transcriptionId}/sentences?per_page=5`);
  const sentUrl = `${BASE_URL}/v2/transcriptions/${encodeURIComponent(transcriptionId)}/sentences?per_page=5`;
  const sentResp = await fetch(sentUrl, { headers });
  console.log("  status:", sentResp.status);

  const sentBody = await sentResp.json();

  if (!sentResp.ok) {
    console.log("  ERROR body:", JSON.stringify(sentBody, null, 2));
  } else {
    const sentences = sentBody?.data ?? sentBody?.sentences ?? [];
    console.log(`  top-level response keys: ${Object.keys(sentBody).join(", ")}`);
    console.log(`  total sentences returned: ${sentences.length}`);

    const sample = sentences.slice(0, 2);
    console.log("  first 2 sentence objects:");
    console.log(JSON.stringify(sample, null, 2));

    if (sample.length > 0) {
      console.log("  sentence keys:", Object.keys(sample[0]).join(", "));
    }
  }

  console.log("\n=== Probe complete");
}

probe().catch((err) => {
  console.error("FATAL:", err);
  process.exit(1);
});
