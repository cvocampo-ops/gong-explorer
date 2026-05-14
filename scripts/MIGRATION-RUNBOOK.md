# Salesloft → Gong Engage migration runbook

Tooling for re-importing recorded Salesloft conversations into Gong Engage with
**true rep ownership** (each rep appears as the call's `primaryUser`, not the
admin who authenticated the API request). Use this when a customer is moving
from Salesloft → Gong and wants their existing call library preserved with
correct attribution so reps can search "my calls" in Gong.

## Prerequisites

1. **Salesloft API key** with read access to `/v2/conversations`, `/v2/conversations/{id}/extensive`, `/v2/conversations/{id}/recording`, `/v2/users`.
2. **Gong API access key + secret** (Basic auth) with `Upload calls` scope.
3. **Per-user permission in Gong**: every rep who should appear as a call owner needs `settings.telephonyCallsImported = true` on their Gong user record. Without this flag, `POST /v2/calls` returns:
   ```
   409 — "Recording or telephony call import is not enabled for primaryUser <id>"
   ```
   Toggle this per user via **Gong Admin → Team members → click rep → Data capture → Telephony calls = ON**. Save. Verify via:
   ```
   GET /v2/users
   → find user → assert .settings.telephonyCallsImported === true
   ```
4. **`.env.local`** in the working directory:
   ```
   SALESLOFT_API_KEY=...
   GONG_ACCESS_KEY=...
   GONG_ACCESS_KEY_SECRET=...
   GONG_BASE_URL=https://us-XXXX.api.gong.io
   ```

## How rep attribution works

Each Salesloft conversation has an `owner_id` (the rep who ran the call). The
migration resolves it to a Gong user through three fallbacks:

1. **Email match** — `slUser.email.toLowerCase()` vs `gongByEmail` map.
2. **`--email-map` override** — explicit `salesloft@old.com=gong.user@new.com` pairs (use when reps had cross-domain rebrands, e.g. `sarah@outboundfunnel.com` → `sarah.sanderson@2x.marketing`).
3. **Name match** — `slUser.name` vs each Gong user's `firstName + " " + lastName`. This catches rebrands automatically when display names match across systems.

Calls whose SL owner doesn't resolve to any *active, permissioned* Gong user
fall back to `--primary` (the admin's account). Logged as `repSource: fallback`
in the JSONL for post-run audit.

## Workflow

### 1. Audit attribution before importing anything

```bash
node scripts/preview-salesloft-import.mjs --limit 10 --primary you@company.com
```

Look at the per-call output: `[resolved via owner-name]` is the success case;
`[FALLBACK — SL owner X not in Gong]` flags calls that would end up under the
admin. If too many fall back, fix the rep mappings (re-activate Gong accounts,
re-create with matching display names, or add `--email-map`) BEFORE migrating.

### 2. Run a single live test

```bash
node scripts/salesloft-to-gong-test.mjs --limit 1 --primary you@company.com
```

Imports the most-recent SL conversation into Gong. Verify in the Gong UI:
- The call exists with audio playback
- "Owner" / "Host" field shows the rep, not the admin
- Participants list includes the rep with a Gong-user badge (not just a name)

### 3. Bulk import

```bash
node scripts/salesloft-to-gong-bulk.mjs --primary you@company.com
```

Processes every SL conversation oldest-first. Writes a per-call JSONL log to
`scripts/salesloft-bulk.jsonl`. Each line records `repEmail`, `repSource`
(`owner-email | owner-override | owner-name | fallback`), `ownerEmailRaw`,
`callId`, `status` (`ok | dedup | error`).

**Flags:**
- `--dry-run` — plan only; no `createCall`, no audio upload. Use first to preview attribution + bucket counts.
- `--limit N` — smoke-test slice.
- `--resume` — skip slIds already in the log (re-runs failures only).
- `--email-map sl1@old.com=gong1@new.com,sl2=gong2` — cross-domain overrides.

Expect ~1–3 calls/min depending on audio size (most time is recording download
+ upload of 50–100 MB per call).

### 4. Verify in Gong

Filter the Gong call list by `customData = salesloft-import:YYYY-MM-DD` to
isolate this import batch. Spot-check:
- Owner labels are correct (the rep, not the admin)
- Participants include other internal Gong users where applicable
- Audio plays back
- "Calls by user" filter for a specific rep now surfaces their migrated calls

## Known Gong API limitations

The Gong API supports `POST /v2/calls` (create) and `PUT /v2/calls/{id}/media`
(attach audio, once). **There is no API to update or delete a call.** This
matters when you discover an attribution mistake after import:

- `PUT/PATCH /v2/calls/{id}` → 405 Method Not Allowed
- `POST /v2/calls/manage` → 405 Method Not Allowed
- `POST /v2/calls/{id}/parties` (and variants) → 404 Not Found
- `DELETE /v2/calls/{id}` (and bulk variants) → 405 Method Not Allowed

The only post-creation mutations are **manual UI flips** (one call at a time
in Gong's Call Info tab) or **Gong support tickets**.

### Deletion + reimport caveat

Even after deleting a call via Gong UI, two server-side registries persist for
an undocumented duration (minutes to hours, possibly indefinitely):

1. **`clientUniqueId → callId` mapping** — `POST /v2/calls` keeps returning the deleted callId via dedup. Bypassable by changing the clientUniqueId scheme (e.g. append `-v2`).
2. **Audio content-hash registry** — `PUT /v2/calls/{id}/media` returns `400 "has been uploaded in the past"` for identical audio bytes, pointing at the deleted call. No code-side bypass.

A single call deleted >1 hour before reimport DID clear both registries
empirically (2026-05-13 test). A bulk-deletion of 200+ calls did NOT clear
them within 30 minutes (2026-05-14 test). For mid-engagement attribution
fixes, plan on waiting hours between delete and reimport, or open a Gong
support ticket asking them to clear the registries server-side.

## Recovery: targeted reimport of a subset

`scripts/reimport-from-cleanup-csv.mjs` reads a CSV of `slId`s and re-runs
just those (not the full corpus). Useful when the original bulk run produced
some calls under the wrong owner (e.g. permission flag was off when the call
was first imported, then turned on later).

```bash
# Build the cleanup CSV manually OR via inline filter on scripts/salesloft-bulk.jsonl
# CSV format (column 2 = slId):
#   callId_to_delete,slId,title,gong_url,intended_rep,pattern

# Dry-run preview
node scripts/reimport-from-cleanup-csv.mjs --dry-run

# Smoke test 5
node scripts/reimport-from-cleanup-csv.mjs --limit 5

# Full re-process
node scripts/reimport-from-cleanup-csv.mjs --cuid-suffix v2
```

`--cuid-suffix v2` appends `-v2` to clientUniqueIds to bypass the dedup-on-deleted
behavior described above. Each invocation creates fresh callIds — the old
deleted-but-tombstoned ones stay hidden in Gong's backend.

## Diagnostics

- `scripts/probe-gong-call-update.mjs --callId X --primary user@company.com` — one-shot probe to confirm Gong's API mutation surface for an existing call (always 404/405 today, but useful sanity check before opening support tickets).
- `scripts/find-gong-user.mjs` — look up a Gong user by email.
- `scripts/inspect-gong-call.mjs` — pull full metadata + parties for a specific Gong callId.

## Glossary

- **`primaryUser`**: Gong's term for the call owner. Drives "calls by user" filtering and analytics rollups.
- **`clientUniqueId`**: idempotency key on `POST /v2/calls`. Our convention: `salesloft-{slId}` for the first migration pass; `salesloft-{slId}-v2` for any subsequent re-passes.
- **`repSource`** (in JSONL log): how we resolved the rep — `owner-email`, `owner-override`, `owner-name`, or `fallback`.
- **`ownerEmailRaw`** (in JSONL log): the Salesloft owner's email, preserved even when we fell back to `--primary`. Lets you grep the log for which calls need rep activation/invitation.
