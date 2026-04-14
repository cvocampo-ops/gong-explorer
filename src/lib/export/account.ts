import type { GongParty } from "@/lib/types";

const PERSONAL_EMAIL_DOMAINS = new Set([
  "gmail.com",
  "googlemail.com",
  "outlook.com",
  "hotmail.com",
  "live.com",
  "yahoo.com",
  "yahoo.co.uk",
  "icloud.com",
  "me.com",
  "mac.com",
  "aol.com",
  "proton.me",
  "protonmail.com",
]);

export function slugify(input: string): string {
  return input
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60) || "untitled";
}

function modeOf(values: string[]): string | undefined {
  if (values.length === 0) return undefined;
  const counts = new Map<string, number>();
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
  let winner: string | undefined;
  let winnerCount = 0;
  for (const [k, c] of counts) {
    if (c > winnerCount) {
      winner = k;
      winnerCount = c;
    }
  }
  return winner;
}

function extractCrmAccountName(parties: GongParty[]): string | undefined {
  const names: string[] = [];
  for (const p of parties) {
    if (!p.context) continue;
    for (const ctx of p.context) {
      if (!ctx.objects) continue;
      for (const obj of ctx.objects) {
        if (obj.objectType !== "Account") continue;
        const nameField = obj.fields?.find(
          (f) => f.name === "Name" || f.name === "name" || f.name === "AccountName"
        );
        if (nameField?.value) names.push(nameField.value);
      }
    }
  }
  return modeOf(names);
}

function extractEmailDomainAccount(parties: GongParty[]): string | undefined {
  const externalParties = parties.filter((p) => p.affiliation !== "Internal");
  const domains: string[] = [];
  for (const p of externalParties) {
    if (!p.emailAddress) continue;
    const at = p.emailAddress.lastIndexOf("@");
    if (at < 0) continue;
    const domain = p.emailAddress.slice(at + 1).toLowerCase();
    if (PERSONAL_EMAIL_DOMAINS.has(domain)) continue;
    const stem = domain.split(".")[0];
    if (stem) domains.push(stem);
  }
  return modeOf(domains);
}

export function extractAccountName(parties: GongParty[] | undefined): string {
  if (!parties || parties.length === 0) return "unknown-account";
  return (
    extractCrmAccountName(parties) ??
    extractEmailDomainAccount(parties) ??
    "unknown-account"
  );
}
