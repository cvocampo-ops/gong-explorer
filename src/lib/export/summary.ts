import type { GongCall } from "@/lib/types";
import { formatDateTime, formatDuration } from "@/lib/format";
import { extractAccountName } from "./account";

function partyLine(p: { name?: string; title?: string; emailAddress?: string }): string {
  const name = p.name ?? "Unknown";
  const extras = [p.title, p.emailAddress].filter(Boolean).join(", ");
  return extras ? `${name} (${extras})` : name;
}

export function renderSummaryMarkdown(call: GongCall): string {
  const lines: string[] = [];
  const title = call.metaData.title || "Untitled Call";
  const account = extractAccountName(call.parties);

  lines.push(`# ${title}`);
  lines.push("");
  lines.push(`**Account:** ${account}`);
  lines.push(`**Date:** ${formatDateTime(call.metaData.started)}`);
  lines.push(`**Duration:** ${formatDuration(call.metaData.duration)}`);
  lines.push(`**System:** ${call.metaData.system}`);
  lines.push(`**Direction:** ${call.metaData.direction}`);
  lines.push(`**Scope:** ${call.metaData.scope}`);
  if (call.metaData.language) lines.push(`**Language:** ${call.metaData.language}`);
  if (call.metaData.url) lines.push(`**Gong URL:** ${call.metaData.url}`);
  lines.push("");

  const internal = call.parties?.filter((p) => p.affiliation === "Internal") ?? [];
  const external = call.parties?.filter((p) => p.affiliation !== "Internal") ?? [];

  if (internal.length > 0 || external.length > 0) {
    lines.push("## Attendees");
    if (internal.length > 0) {
      lines.push("");
      lines.push("**Internal:**");
      for (const p of internal) lines.push(`- ${partyLine(p)}`);
    }
    if (external.length > 0) {
      lines.push("");
      lines.push("**External:**");
      for (const p of external) lines.push(`- ${partyLine(p)}`);
    }
    lines.push("");
  }

  if (call.content?.brief) {
    lines.push("## AI Summary");
    lines.push("");
    lines.push(call.content.brief);
    lines.push("");
  }

  if (call.content?.highlights && call.content.highlights.length > 0) {
    lines.push("## Highlights");
    lines.push("");
    for (const h of call.content.highlights) {
      lines.push(`### ${h.title}`);
      for (const item of h.items) lines.push(`- ${item.text}`);
      lines.push("");
    }
  }

  if (call.content?.topics && call.content.topics.length > 0) {
    lines.push("## Topics");
    lines.push("");
    for (const t of call.content.topics) {
      const dur = t.duration ? ` (${formatDuration(t.duration)})` : "";
      lines.push(`- ${t.name}${dur}`);
    }
    lines.push("");
  }

  if (call.content?.callOutcome) {
    lines.push("## Outcome");
    lines.push("");
    lines.push(call.content.callOutcome);
    lines.push("");
  }

  if (call.content?.trackers && call.content.trackers.length > 0) {
    lines.push("## Trackers");
    lines.push("");
    for (const t of call.content.trackers) {
      lines.push(`- ${t.name}: ${t.count}`);
    }
    lines.push("");
  }

  return lines.join("\n");
}

export function renderTranscriptText(transcript: {
  transcript: Array<{
    speakerId?: string;
    topic?: string;
    sentences: Array<{ start: number; end: number; text: string }>;
  }>;
}): string {
  const lines: string[] = [];
  for (const segment of transcript.transcript) {
    const speaker = segment.speakerId ?? "Unknown";
    const topic = segment.topic ? ` [${segment.topic}]` : "";
    const text = segment.sentences.map((s) => s.text).join(" ");
    lines.push(`${speaker}${topic}: ${text}`);
    lines.push("");
  }
  return lines.join("\n");
}
