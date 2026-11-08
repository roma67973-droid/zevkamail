import type { Env, InboundEmail, InboxResponse, StoredEmail } from "./types";
import { getConfig } from "./config";
import { newEmailId } from "./utils/id";
import { shouldSpillToR2 } from "./utils/split";

/**
 * Maximum lengths of the inline previews kept in D1 when the body is spilled
 * to R2. Reads of the inbox listing return these previews so we never have to
 * round-trip to R2 just to render the inbox.
 */
const TEXT_PREVIEW_LIMIT = 512;
const HTML_PREVIEW_LIMIT = 1024;

/**
 * R2 key for the spilled body of an email.
 *
 * Body objects live under `bodies/{id}.json` and are deleted alongside the
 * row in `deleteEmail`, `deleteInbox`, and the cron `deleteExpired` sweep.
 */
function bodyKey(id: string): string {
  return `bodies/${id}.json`;
}

/**
 * Address normalization on the WRITE path: D1 stores everything lowercased
 * so the indexes are predictable. Reads also lowercase so a user looking at
 * `Foo@Bar.com` sees the same inbox as `foo@bar.com`.
 */
function normalizeAddress(address: string): string {
  return address.toLowerCase();
}

interface EmailRow {
  id: string;
  address: string;
  from_addr: string;
  subject: string;
  text_body: string;
  html_body: string;
  text_preview: string;
  html_preview: string;
  headers_json: string;
  received_at_ms: number;
  received_at_iso: string;
  expires_at_ms: number;
  has_r2: number;
  r2_key: string | null;
}

/**
 * Hydrate a `StoredEmail` from a D1 row, fetching the spilled body from R2
 * when needed. R2 fetches are skipped when the caller only wants the inbox
 * preview shape (we still return the previews as `text`/`html` so the wire
 * format stays compatible with the existing OpenAPI types).
 */
async function rowToStoredEmail(
  row: EmailRow,
  env: Env,
  hydrate: boolean,
): Promise<StoredEmail> {
  let text = row.text_body || "";
  let html = row.html_body || "";

  if (row.has_r2 === 1 && row.r2_key) {
    if (hydrate) {
      const obj = env.R2 ? await env.R2.get(row.r2_key) : null;
      if (obj) {
        try {
          const body = (await obj.json()) as { text?: string; html?: string };
          text = body.text ?? "";
          html = body.html ?? "";
        } catch {
          // Fall back to the inline previews if the R2 object is corrupt.
          text = row.text_preview || "";
          html = row.html_preview || "";
        }
      } else {
        text = row.text_preview || "";
        html = row.html_preview || "";
      }
    } else {
      text = row.text_preview || "";
      html = row.html_preview || "";
    }
  }

  let headers: Record<string, string> = {};
  try {
    headers = JSON.parse(row.headers_json || "{}");
  } catch {
    headers = {};
  }

  return {
    id: row.id,
    to: row.address,
    from: row.from_addr,
    subject: row.subject,
    text,
    html,
    headers,
    receivedAt: row.received_at_iso,
  };
}

/* ------------------------------------------------------------------ */
/* mail-hub: saved mailboxes                                           */
/* ------------------------------------------------------------------ */

/** "Never expires" marker for emails of permanent mailboxes (year ~2286). */
export const FOREVER_MS = 9_999_999_999_999;

export type MailboxKind = "temp" | "permanent";

export interface MailboxRecord {
  address: string;
  kind: MailboxKind;
  label: string | null;
  createdAt: number;
  updatedAt: number;
}

interface MailboxRow {
  address: string;
  kind: MailboxKind;
  label: string | null;
  created_at_ms: number;
  updated_at_ms: number;
}

function rowToMailbox(r: MailboxRow): MailboxRecord {
  return {
    address: r.address,
    kind: r.kind,
    label: r.label,
    createdAt: r.created_at_ms,
    updatedAt: r.updated_at_ms,
  };
}

export async function listMailboxes(env: Env): Promise<MailboxRecord[]> {
  const res = await env.DB.prepare(
    `SELECT * FROM mailboxes ORDER BY created_at_ms DESC LIMIT ${MAX_MAILBOXES}`,
  ).all<MailboxRow>();
  return (res.results ?? []).map(rowToMailbox);
}

async function getMailboxKind(env: Env, address: string): Promise<MailboxKind | null> {
  const row = await env.DB.prepare(`SELECT kind FROM mailboxes WHERE address = ?`)
    .bind(address)
    .first<{ kind: MailboxKind }>();
  return row?.kind ?? null;
}

/** Max saved mailboxes (protects D1 from runaway clients). */
export const MAX_MAILBOXES = 1000;

/**
 * Re-time emails of an address to match the mailbox's CURRENT kind in the DB
 * (read inside the same statement, so concurrent requests can't leave them
 * out of sync). Idempotent:
 *  - permanent → every email gets FOREVER_MS;
 *  - temp / no mailbox → only emails that were FOREVER get `now + TTL`,
 *    i.e. a full TTL of grace after unpinning, not instant deletion of old mail.
 */
function retimeStatement(env: Env, address: string): D1PreparedStatement {
  const graceUntil = Date.now() + getConfig(env).emailTtlSeconds * 1000;
  return env.DB.prepare(
    `UPDATE emails SET expires_at_ms =
       CASE WHEN EXISTS (SELECT 1 FROM mailboxes WHERE address = ?1 AND kind = 'permanent')
            THEN ?2 ELSE ?3 END
     WHERE address = ?1 AND
       CASE WHEN EXISTS (SELECT 1 FROM mailboxes WHERE address = ?1 AND kind = 'permanent')
            THEN expires_at_ms <> ?2 ELSE expires_at_ms = ?2 END`,
  ).bind(address, FOREVER_MS, graceUntil);
}

export class MailboxLimitError extends Error {}

/**
 * Create or update a mailbox. Only the fields present in `patch` change
 * (`label: null`/"" clears it). With `ifAbsent`, an existing mailbox is left
 * untouched — used when a device uploads its old local list, so stale data
 * can't overwrite what another device set. With an empty patch on an existing
 * mailbox it only bumps `updated_at_ms` ("touch" = mailbox is in use).
 */
export async function upsertMailbox(
  env: Env,
  rawAddress: string,
  patch: { kind?: MailboxKind; label?: string | null; createdAt?: number; ifAbsent?: boolean },
): Promise<MailboxRecord> {
  const address = normalizeAddress(rawAddress);
  const now = Date.now();
  const exists = await env.DB.prepare(`SELECT 1 FROM mailboxes WHERE address = ?`)
    .bind(address)
    .first();

  if (!exists) {
    const count = await env.DB.prepare(`SELECT COUNT(*) AS c FROM mailboxes`).first<{ c: number }>();
    if ((count?.c ?? 0) >= MAX_MAILBOXES) throw new MailboxLimitError();
  }

  const createdAt =
    patch.createdAt && Number.isInteger(patch.createdAt) && patch.createdAt > 0 && patch.createdAt <= now
      ? patch.createdAt
      : now;
  const label = patch.label === undefined ? null : patch.label?.trim() || null;
  const sets = ["updated_at_ms = excluded.updated_at_ms"];
  if (patch.kind !== undefined) sets.push("kind = excluded.kind");
  if (patch.label !== undefined) sets.push("label = excluded.label");
  const onConflict = patch.ifAbsent ? "DO NOTHING" : `DO UPDATE SET ${sets.join(", ")}`;

  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO mailboxes (address, kind, label, created_at_ms, updated_at_ms)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(address) ${onConflict}`,
    ).bind(address, patch.kind ?? "temp", label, createdAt, now),
    retimeStatement(env, address),
  ]);

  const row = await env.DB.prepare(`SELECT * FROM mailboxes WHERE address = ?`)
    .bind(address)
    .first<MailboxRow>();
  return rowToMailbox(row!);
}

/** Mark a saved mailbox as in use (bumps updated_at_ms). Never creates one. */
export async function touchMailbox(env: Env, rawAddress: string): Promise<boolean> {
  const r = await env.DB.prepare(`UPDATE mailboxes SET updated_at_ms = ? WHERE address = ?`)
    .bind(Date.now(), normalizeAddress(rawAddress))
    .run();
  return (r.meta?.changes ?? 0) > 0;
}

/**
 * Remove a mailbox from the saved list. Its emails stay; if it was permanent
 * they go back to a normal TTL counted from now.
 */
export async function removeMailbox(env: Env, rawAddress: string): Promise<{ deleted: boolean }> {
  const address = normalizeAddress(rawAddress);
  const [del] = await env.DB.batch([
    env.DB.prepare(`DELETE FROM mailboxes WHERE address = ?`).bind(address),
    retimeStatement(env, address),
  ]);
  return { deleted: (del.meta?.changes ?? 0) > 0 };
}

/**
 * Persist an inbound email. Hot path: <100KB → single D1 INSERT, no R2 write.
 * Spill path: D1 INSERT (with previews) + 1 R2 PUT.
 */
export async function storeEmail(env: Env, email: InboundEmail): Promise<string> {
  const cfg = getConfig(env);
  const id = newEmailId();
  const nowMs = Date.now();
  const nowIso = new Date(nowMs).toISOString();
  const address = normalizeAddress(email.to);
  // Mail to a permanent mailbox never expires. If the mailboxes table is
  // missing (code deployed before migration 0002), fall back to the TTL
  // instead of rejecting every incoming email.
  let kind: MailboxKind | null = null;
  try {
    kind = await getMailboxKind(env, address);
  } catch (err) {
    console.error("[storeEmail] mailboxes lookup failed, using TTL:", err);
  }
  const expiresAtMs = kind === "permanent" ? FOREVER_MS : nowMs + cfg.emailTtlSeconds * 1000;
  // Cap header/subject size so a bloated header block can't push the row
  // over D1's 2 MB limit (and lose the whole email).
  let headersJson = JSON.stringify(email.headers || {});
  if (headersJson.length > HEADERS_MAX_CHARS) headersJson = "{}";
  email = { ...email, subject: (email.subject || "").slice(0, 2000), from: (email.from || "").slice(0, 1000) };
  let text = email.text || "";
  let html = email.html || "";

  // Without an R2 bucket (not enabled on the account) big bodies stay in D1,
  // trimmed so the row fits under D1's 2 MB row limit.
  if (!env.R2) {
    [text, html] = fitInline(text, html, INLINE_MAX_BYTES);
  }

  const spill = !!env.R2 && shouldSpillToR2({
    to: email.to,
    from: email.from,
    subject: email.subject,
    text,
    html,
    headers: email.headers || {},
  });

  if (spill) {
    const key = bodyKey(id);
    const payload = JSON.stringify({ text, html });
    await env.R2!.put(key, payload, {
      httpMetadata: { contentType: "application/json" },
    });
    await env.DB.prepare(
      `INSERT INTO emails (
        id, address, from_addr, subject,
        text_body, html_body, text_preview, html_preview,
        headers_json, received_at_ms, received_at_iso, expires_at_ms,
        has_r2, r2_key
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
      .bind(
        id,
        address,
        email.from,
        email.subject,
        "",
        "",
        text.slice(0, TEXT_PREVIEW_LIMIT),
        html.slice(0, HTML_PREVIEW_LIMIT),
        headersJson,
        nowMs,
        nowIso,
        expiresAtMs,
        1,
        key,
      )
      .run();
  } else {
    await env.DB.prepare(
      `INSERT INTO emails (
        id, address, from_addr, subject,
        text_body, html_body, text_preview, html_preview,
        headers_json, received_at_ms, received_at_iso, expires_at_ms,
        has_r2, r2_key
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
      .bind(
        id,
        address,
        email.from,
        email.subject,
        text,
        html,
        "",
        "",
        headersJson,
        nowMs,
        nowIso,
        expiresAtMs,
        0,
        null,
      )
      .run();
  }

  return id;
}

/**
 * Paginated inbox listing. Filters out expired rows so users never see
 * mail that the cron sweep is about to remove.
 */
export async function getInbox(
  env: Env,
  address: string,
  page = 1,
  limit = 10,
): Promise<InboxResponse> {
  const safePage = Number.isFinite(page) && page > 0 ? Math.floor(page) : 1;
  const safeLimit = Number.isFinite(limit) && limit > 0 ? Math.floor(limit) : 10;
  const normalized = normalizeAddress(address);
  const offset = (safePage - 1) * safeLimit;
  const nowMs = Date.now();

  const totalRow = await env.DB.prepare(
    `SELECT COUNT(*) AS c FROM emails WHERE address = ? AND expires_at_ms > ?`,
  )
    .bind(normalized, nowMs)
    .first<{ c: number }>();
  const total = totalRow?.c ?? 0;

  const rowsResult = await env.DB.prepare(
    `SELECT * FROM emails
     WHERE address = ? AND expires_at_ms > ?
     ORDER BY received_at_ms DESC
     LIMIT ? OFFSET ?`,
  )
    .bind(normalized, nowMs, safeLimit, offset)
    .all<EmailRow>();

  const rows = rowsResult.results ?? [];
  const emails: StoredEmail[] = [];
  for (const row of rows) {
    emails.push(await rowToStoredEmail(row, env, false));
  }

  return {
    emails,
    pagination: {
      page: safePage,
      limit: safeLimit,
      totalEmails: total,
      totalPages: total === 0 ? 0 : Math.ceil(total / safeLimit),
      hasMore: safePage * safeLimit < total,
    },
  };
}

/**
 * Fetch a single email by ID. Hydrates the body from R2 if it spilled.
 * Returns null for unknown or expired rows.
 */
export async function getEmail(env: Env, id: string): Promise<StoredEmail | null> {
  const nowMs = Date.now();
  const row = await env.DB.prepare(
    `SELECT * FROM emails WHERE id = ? AND expires_at_ms > ?`,
  )
    .bind(id, nowMs)
    .first<EmailRow>();
  if (!row) return null;
  return rowToStoredEmail(row, env, true);
}

/**
 * Delete every email for an address. Returns the number of D1 rows removed
 * (matches the server contract). R2 spilled bodies are deleted alongside.
 */
export async function deleteInbox(
  env: Env,
  address: string,
): Promise<{ deleted: number }> {
  const normalized = normalizeAddress(address);
  const rowsResult = await env.DB.prepare(
    `SELECT id, r2_key, has_r2 FROM emails WHERE address = ?`,
  )
    .bind(normalized)
    .all<{ id: string; r2_key: string | null; has_r2: number }>();

  const rows = rowsResult.results ?? [];
  if (rows.length === 0) return { deleted: 0 };

  const r2Keys = rows
    .filter((r) => r.has_r2 === 1 && r.r2_key)
    .map((r) => r.r2_key as string);
  if (r2Keys.length > 0 && env.R2) {
    await env.R2.delete(r2Keys);
  }

  await env.DB.prepare(`DELETE FROM emails WHERE address = ?`)
    .bind(normalized)
    .run();

  return { deleted: rows.length };
}

/**
 * Delete a single email. Returns `{ deleted: false }` for unknown IDs to
 * match the server contract.
 */
export async function deleteEmail(
  env: Env,
  id: string,
): Promise<{ deleted: boolean }> {
  const row = await env.DB.prepare(
    `SELECT id, r2_key, has_r2 FROM emails WHERE id = ?`,
  )
    .bind(id)
    .first<{ id: string; r2_key: string | null; has_r2: number }>();
  if (!row) return { deleted: false };

  if (row.has_r2 === 1 && row.r2_key && env.R2) {
    await env.R2.delete(row.r2_key);
  }
  await env.DB.prepare(`DELETE FROM emails WHERE id = ?`).bind(id).run();
  return { deleted: true };
}

/**
 * Cron sweep: drop every expired row plus its R2 body. Idempotent.
 */
export async function deleteExpired(env: Env): Promise<{ deleted: number }> {
  const nowMs = Date.now();
  const rowsResult = await env.DB.prepare(
    `SELECT id, r2_key, has_r2 FROM emails WHERE expires_at_ms <= ?`,
  )
    .bind(nowMs)
    .all<{ id: string; r2_key: string | null; has_r2: number }>();

  const rows = rowsResult.results ?? [];
  if (rows.length === 0) return { deleted: 0 };

  const r2Keys = rows
    .filter((r) => r.has_r2 === 1 && r.r2_key)
    .map((r) => r.r2_key as string);
  if (r2Keys.length > 0 && env.R2) {
    await env.R2.delete(r2Keys);
  }

  await env.DB.prepare(`DELETE FROM emails WHERE expires_at_ms <= ?`)
    .bind(nowMs)
    .run();

  return { deleted: rows.length };
}

/**
 * Health check used by `/api/health`. Verifies that both D1 and R2 are
 * reachable; the API uses this to populate the `redis` boolean in the
 * health response (the field name is preserved for wire compatibility
 * with the original CloakMail API even though there is no Redis here).
 */
export async function isHealthy(env: Env): Promise<boolean> {
  try {
    await env.DB.prepare(`SELECT 1`).first();
    if (env.R2) await env.R2.head("__healthcheck__");
    return true;
  } catch {
    return false;
  }
}

/** Body budget for one D1 row when there is no R2 (D1 rows max out at 2 MB). */
const INLINE_MAX_BYTES = 1_500_000;
/** Headers JSON above this (chars, ≤3 bytes each → ≤192 KB) is dropped. */
const HEADERS_MAX_CHARS = 64_000;
const TRIM_NOTE = "\n\n[mail-hub: письмо слишком большое, конец обрезан]";

/**
 * Make text + html fit in `maxBytes` of UTF-8: keep the smaller part whole when
 * it is reasonably small, trim the other (or both to half). Each string is
 * encoded at most once, so big emails don't burn CPU time.
 */
export function fitInline(text: string, html: string, maxBytes: number): [string, string] {
  // Fast path: one UTF-16 unit is at most 3 UTF-8 bytes.
  if ((text.length + html.length) * 3 <= maxBytes) return [text, html];
  const enc = new TextEncoder();
  const dec = new TextDecoder();
  const tb = enc.encode(text);
  const hb = enc.encode(html);
  const t = tb.length;
  const h = hb.length;
  if (t + h <= maxBytes) return [text, html];
  // Cut at a byte limit; a split multi-byte char at the end decodes to U+FFFD, drop it.
  const cut = (b: Uint8Array, bytes: number) =>
    bytes <= 0 ? "" : dec.decode(b.subarray(0, Math.floor(bytes))).replace(/�+$/, "") + TRIM_NOTE;
  const room = maxBytes - 200; // TRIM_NOTE is ~90 bytes
  if (t <= h || h > maxBytes / 2) {
    if (t > maxBytes / 2) return [cut(tb, room / 2), cut(hb, room / 2)];
    return [text, cut(hb, room - t)];
  }
  return [cut(tb, room - h), html];
}
