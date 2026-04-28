import type { ImportCallMetadata, ImportCallParty } from "./types";

interface RawExportParty {
  id?: string;
  emailAddress?: string;
  name?: string;
  title?: string;
  userId?: string;
  speakerId?: string;
  affiliation?: string;
  phoneNumber?: string;
  methods?: string[];
}

interface RawExportMetaData {
  id?: string;
  url?: string;
  title?: string;
  scheduled?: string | null;
  started?: string;
  duration?: number;
  primaryUserId?: string;
  direction?: string;
  system?: string;
  scope?: string;
  media?: string;
  language?: string;
  workspaceId?: string;
  sdrDisposition?: string | null;
  clientUniqueId?: string | null;
  customData?: string | null;
  purpose?: string | null;
  meetingUrl?: string;
  isPrivate?: boolean;
  calendarEventId?: string;
}

export interface RawGongExport {
  metaData?: RawExportMetaData;
  parties?: RawExportParty[];
  // content / interaction / collaboration / media exist in the export but
  // are not used during re-import.
  [key: string]: unknown;
}

const LANGUAGE_MAP: Record<string, string> = {
  eng: "en",
  spa: "es",
  fra: "fr",
  fre: "fr",
  deu: "de",
  ger: "de",
  por: "pt",
  ita: "it",
  jpn: "ja",
  kor: "ko",
  zho: "zh",
  chi: "zh",
  rus: "ru",
  nld: "nl",
  pol: "pl",
};

function mapLanguage(code: string | undefined): string | undefined {
  if (!code) return undefined;
  const lower = code.trim().toLowerCase();
  return LANGUAGE_MAP[lower] ?? lower;
}

function mapDirection(
  raw: string | undefined
): ImportCallMetadata["direction"] {
  switch (raw) {
    case "Inbound":
    case "Outbound":
    case "Conference":
    case "Unknown":
      return raw;
    default:
      return "Unknown";
  }
}

function mapAffiliation(
  raw: string | undefined
): ImportCallParty["affiliation"] {
  switch (raw) {
    case "Internal":
    case "External":
    case "Unknown":
      return raw;
    default:
      return undefined;
  }
}

function mapMethods(raw: string[] | undefined): ImportCallParty["methods"] {
  if (!raw || raw.length === 0) return undefined;
  const allowed: ImportCallParty["methods"] = [];
  for (const m of raw) {
    if (m === "Invitee" || m === "Attendee" || m === "Organizer") {
      allowed.push(m);
    }
  }
  return allowed.length > 0 ? allowed : undefined;
}

function mapParty(raw: RawExportParty): ImportCallParty | null {
  const out: ImportCallParty = {};
  if (raw.userId) out.userId = raw.userId;
  if (raw.name) out.name = raw.name;
  if (raw.emailAddress) out.emailAddress = raw.emailAddress;
  if (raw.phoneNumber) out.phoneNumber = raw.phoneNumber;
  if (raw.title) out.title = raw.title;
  const aff = mapAffiliation(raw.affiliation);
  if (aff) out.affiliation = aff;
  const methods = mapMethods(raw.methods);
  if (methods) out.methods = methods;

  // Drop completely empty parties; createCall will synthesize partyHash later.
  if (
    !out.userId &&
    !out.emailAddress &&
    !out.name &&
    !out.phoneNumber
  ) {
    return null;
  }
  return out;
}

function fallbackClientUniqueId(): string {
  return `ce-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

export interface MapperOverrides {
  workspaceId?: string;
  title?: string;
  primaryUser?: string;
}

/**
 * Maps a raw Gong export `metadata.json` into the ImportCallMetadata shape.
 * `metadata.json` is already in Gong's native schema, so the mapping is mostly direct.
 */
export function mapExportToImportMetadata(
  raw: RawGongExport,
  overrides?: MapperOverrides
): ImportCallMetadata {
  const meta = raw.metaData ?? {};
  const parties = (raw.parties ?? [])
    .map(mapParty)
    .filter((p): p is ImportCallParty => p !== null);

  const primaryUser =
    overrides?.primaryUser ||
    meta.primaryUserId ||
    parties.find((p) => p.affiliation === "Internal" && p.userId)?.userId ||
    "";

  const clientUniqueId =
    meta.clientUniqueId ?? meta.id ?? fallbackClientUniqueId();

  const out: ImportCallMetadata = {
    clientUniqueId,
    actualStart: meta.started ?? new Date().toISOString(),
    direction: mapDirection(meta.direction),
    primaryUser,
    parties,
  };

  const title = overrides?.title || meta.title;
  if (title) out.title = title;

  if (meta.purpose) out.purpose = meta.purpose;
  if (meta.system) out.system = meta.system;
  if (meta.scheduled) out.scheduledStart = meta.scheduled;
  if (meta.meetingUrl) out.meetingUrl = meta.meetingUrl;

  const workspaceId = overrides?.workspaceId || meta.workspaceId;
  if (workspaceId) out.workspaceId = workspaceId;

  const lang = mapLanguage(meta.language);
  if (lang) out.languageCode = lang;

  if (meta.customData) out.customData = meta.customData;
  if (meta.sdrDisposition) out.disposition = meta.sdrDisposition;

  return out;
}
