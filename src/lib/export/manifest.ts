import type { ManifestRow } from "@/lib/types";

const COLUMNS: Array<keyof ManifestRow> = [
  "id",
  "provider",
  "date",
  "title",
  "account",
  "duration_min",
  "direction",
  "system",
  "internal_attendees",
  "external_attendees",
  "outcome",
  "folder",
  "media_included",
  "transcript_included",
  "status",
  "error",
];

function csvEscape(value: unknown): string {
  if (value === null || value === undefined) return "";
  const str = String(value);
  if (/[",\n\r]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

export function buildManifestCsv(rows: ManifestRow[]): string {
  const header = COLUMNS.join(",");
  const body = rows.map((row) => COLUMNS.map((c) => csvEscape(row[c])).join(","));
  return [header, ...body].join("\n") + "\n";
}

export function buildManifestJson(rows: ManifestRow[]): string {
  return JSON.stringify(rows, null, 2);
}
