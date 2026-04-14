import type { GongCall, NormalizedCall, NormalizedParty } from "./types";

export function gongToNormalized(call: GongCall): NormalizedCall {
  const parties: NormalizedParty[] = (call.parties ?? []).map((p) => ({
    name: p.name,
    email: p.emailAddress,
    title: p.title,
    affiliation: p.affiliation,
  }));

  return {
    provider: "gong",
    id: call.metaData.id,
    title: call.metaData.title || "Untitled Call",
    started: call.metaData.started,
    durationSec: call.metaData.duration,
    direction: call.metaData.direction,
    system: call.metaData.system,
    scope: call.metaData.scope,
    media: call.metaData.media,
    url: call.metaData.url,
    audioUrl: call.media?.audioUrl,
    videoUrl: call.media?.videoUrl,
    parties,
    summary: call.content?.brief,
    outcome: call.content?.callOutcome,
    language: call.metaData.language,
    raw: call,
  };
}
