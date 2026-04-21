import type {
  SalesLoftExtensiveConversation,
  SalesLoftParticipant,
  SalesLoftTranscriptionSentence,
} from "@/lib/types";
import { formatDateTime, formatDuration } from "@/lib/format";

function inferAffiliation(
  p: SalesLoftParticipant,
  ownerEmail?: string
): "Internal" | "External" | "Unknown" {
  if (p.role === "rep" || p.role === "user" || p.role === "host") return "Internal";
  if (p.role === "prospect" || p.role === "customer" || p.role === "contact") return "External";
  if (ownerEmail && p.email && p.email.toLowerCase() === ownerEmail.toLowerCase()) return "Internal";
  if (ownerEmail && p.email) {
    const ownerDomain = ownerEmail.split("@")[1]?.toLowerCase();
    const partyDomain = p.email.split("@")[1]?.toLowerCase();
    if (ownerDomain && partyDomain) return ownerDomain === partyDomain ? "Internal" : "External";
  }
  return "Unknown";
}

function partyLine(p: SalesLoftParticipant): string {
  const name = p.name ?? "Unknown";
  const extras = [p.role, p.email].filter(Boolean).join(", ");
  return extras ? `${name} (${extras})` : name;
}

export function renderSalesloftSummaryMarkdown(c: SalesLoftExtensiveConversation): string {
  const lines: string[] = [];
  const title = c.title ?? c.subject ?? `Conversation ${c.id}`;
  const account = c.account?.name ?? "unknown-account";
  const started = c.started_at ?? c.created_at ?? "";
  const ownerEmail = c.user?.email;

  lines.push(`# ${title}`);
  lines.push("");
  lines.push(`**Account:** ${account}`);
  if (started) lines.push(`**Date:** ${formatDateTime(started)}`);
  if (typeof c.duration === "number") lines.push(`**Duration:** ${formatDuration(Math.round(c.duration / 1000))}`);
  lines.push(`**System:** SalesLoft`);
  if (c.direction) lines.push(`**Direction:** ${c.direction}`);
  if (c.call_type) lines.push(`**Scope:** ${c.call_type}`);
  lines.push("");

  const participants = c.participants ?? [];
  const withAff = participants.map((p) => ({ p, aff: inferAffiliation(p, ownerEmail) }));
  const internal = withAff.filter((x) => x.aff === "Internal").map((x) => x.p);
  const external = withAff.filter((x) => x.aff !== "Internal").map((x) => x.p);

  // Include the call owner as internal if not already in participants.
  if (
    c.user &&
    !participants.some(
      (p) => p.email && c.user?.email && p.email.toLowerCase() === c.user.email.toLowerCase()
    )
  ) {
    internal.unshift({ name: c.user.name, email: c.user.email });
  }

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

  if (c.summary?.text) {
    lines.push("## AI Summary");
    lines.push("");
    lines.push(c.summary.text);
    lines.push("");
  }

  const actionItems = c.action_items?.items ?? [];
  if (actionItems.length > 0) {
    lines.push("## Action Items");
    lines.push("");
    for (const item of actionItems) {
      if (item.original_text) lines.push(`- ${item.original_text}`);
    }
    lines.push("");
  }

  const keyMoments = c.key_moments?.items ?? [];
  if (keyMoments.length > 0) {
    lines.push("## Key Moments");
    lines.push("");
    for (const m of keyMoments) {
      if (m.name) lines.push(`- ${m.name}`);
    }
    lines.push("");
  }

  if (c.call_disposition) {
    lines.push("## Outcome");
    lines.push("");
    lines.push(c.call_disposition);
    lines.push("");
  }

  return lines.join("\n");
}

export function renderSalesloftTranscriptText(
  sentences: SalesLoftTranscriptionSentence[]
): string {
  // Sort by order_number to guarantee correct ordering even if the API returns them out of order.
  const sorted = [...sentences].sort((a, b) => {
    const ao = a.order_number ?? 0;
    const bo = b.order_number ?? 0;
    return ao - bo;
  });

  // Group consecutive sentences by speaker so output reads like a dialog.
  const lines: string[] = [];
  let currentSpeaker: string | null = null;
  let currentBuffer: string[] = [];

  const flush = () => {
    if (currentSpeaker !== null && currentBuffer.length > 0) {
      lines.push(`${currentSpeaker}: ${currentBuffer.join(" ")}`);
      lines.push("");
    }
    currentBuffer = [];
  };

  for (const s of sentences.length > 0 ? sorted : []) {
    const speaker =
      s.recording_attendee_id !== undefined && s.recording_attendee_id !== null
        ? `Speaker ${s.recording_attendee_id}`
        : "Unknown";
    const text = (s.text ?? "").trim();
    if (!text) continue;
    if (speaker !== currentSpeaker) {
      flush();
      currentSpeaker = speaker;
    }
    currentBuffer.push(text);
  }
  flush();

  return lines.join("\n");
}
