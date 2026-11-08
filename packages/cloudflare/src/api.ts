import { Hono } from "hono";
import type { Env } from "./types";
import {
  deleteEmail,
  deleteInbox,
  getEmail,
  getInbox,
  isHealthy,
  listMailboxes,
  MailboxLimitError,
  removeMailbox,
  touchMailbox,
  upsertMailbox,
  type MailboxKind,
} from "./store";

/** local@domain, same rules as the web form. */
const MAILBOX_RE = /^[a-z0-9][a-z0-9._+-]{0,63}@[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)*$/i;

/**
 * Captured at module load (per-isolate) so we can report a Worker uptime
 * for the health endpoint.
 * The number resets per cold start, which is the closest analog Workers
 * can offer.
 */
const BOOT_TIME_MS = Date.now();

/** Compare two strings without leaking where they differ via timing. */
function safeEqual(a: string, b: string): boolean {
  const enc = new TextEncoder();
  const x = enc.encode(a);
  const y = enc.encode(b);
  let diff = x.length ^ y.length;
  for (let i = 0; i < y.length; i++) {
    diff |= (x[i] ?? 0) ^ y[i];
  }
  return diff === 0;
}

/**
 * The Hono app keeps the original CloakMail routes (inbox, email, health)
 * plus /api/mailboxes added in this fork. Path, method, params, query, and response
 * shapes match 1:1 so the existing OpenAPI types in
 * `packages/web/src/lib/types/api.d.ts` keep working without regeneration.
 */
export function createApiApp(): Hono<{ Bindings: Env }> {
  const app = new Hono<{ Bindings: Env }>();

  // Optional API key (idea taken from MailTub). When API_KEY is set, every
  // /api/* route except /api/health needs a matching `X-API-Key` header.
  // When it is empty the API stays open, as in upstream CloakMail.
  app.use("/api/*", async (c, next) => {
    const expected = c.env.API_KEY;
    if (!expected || c.req.path === "/api/health") {
      return next();
    }
    const got = c.req.header("X-API-Key") ?? "";
    if (!safeEqual(got, expected)) {
      return c.json({ error: "Unauthorized" }, 401);
    }
    return next();
  });

  app.get("/api/inbox/:address", async (c) => {
    const address = c.req.param("address");
    const page = Number(c.req.query("page")) || 1;
    const limit = Math.min(Number(c.req.query("limit")) || 10, 50);
    const result = await getInbox(c.env, address, page, limit);
    return c.json(result);
  });

  app.get("/api/email/:id", async (c) => {
    const id = c.req.param("id");
    const email = await getEmail(c.env, id);
    if (!email) {
      return c.json({ error: "Email not found" }, 404);
    }
    return c.json(email);
  });

  app.delete("/api/inbox/:address", async (c) => {
    const address = c.req.param("address");
    const result = await deleteInbox(c.env, address);
    return c.json(result);
  });

  app.delete("/api/email/:id", async (c) => {
    const id = c.req.param("id");
    const result = await deleteEmail(c.env, id);
    return c.json(result);
  });

  // --- mail-hub: saved mailboxes (shared between devices) ---

  app.get("/api/mailboxes", async (c) => {
    return c.json({ mailboxes: await listMailboxes(c.env) });
  });

  app.put("/api/mailboxes/:address", async (c) => {
    const address = c.req.param("address");
    if (!MAILBOX_RE.test(address)) {
      return c.json({ error: "Invalid address" }, 400);
    }
    let body: { kind?: unknown; label?: unknown; createdAt?: unknown; ifAbsent?: unknown; touch?: unknown };
    try {
      body = await c.req.json();
    } catch {
      body = {};
    }
    if (body.kind !== undefined && body.kind !== "temp" && body.kind !== "permanent") {
      return c.json({ error: "kind must be 'temp' or 'permanent'" }, 400);
    }
    if (body.label !== undefined && body.label !== null && typeof body.label !== "string") {
      return c.json({ error: "label must be a string" }, 400);
    }
    // "In use" ping: bump updated_at only, never (re)create a mailbox.
    if (body.touch === true) {
      return c.json({ touched: await touchMailbox(c.env, address) });
    }
    try {
      const mailbox = await upsertMailbox(c.env, address, {
        kind: body.kind as MailboxKind | undefined,
        label: typeof body.label === "string" ? body.label.slice(0, 60) : (body.label as null | undefined),
        createdAt: typeof body.createdAt === "number" ? Math.floor(body.createdAt) : undefined,
        ifAbsent: body.ifAbsent === true,
      });
      return c.json(mailbox);
    } catch (err) {
      if (err instanceof MailboxLimitError) {
        return c.json({ error: "Too many mailboxes" }, 429);
      }
      throw err;
    }
  });

  app.delete("/api/mailboxes/:address", async (c) => {
    const address = c.req.param("address");
    if (!MAILBOX_RE.test(address)) {
      return c.json({ error: "Invalid address" }, 400);
    }
    return c.json(await removeMailbox(c.env, address));
  });

  app.get("/api/health", async (c) => {
    // Workers don't have a long-lived SMTP server or `process.uptime()`,
    // so we shim those fields:
    //   - smtp: true — having an `email` export means Email Routing is
    //     hooked up; from the wire's perspective that's "SMTP running".
    //   - redis: storage backend (D1 + R2) reachable. Field name preserved
    //     for compatibility with the original CloakMail wire format.
    //   - uptime: seconds since this isolate booted.
    const storageOk = await isHealthy(c.env);
    return c.json({
      status: "ok",
      smtp: true,
      redis: storageOk,
      uptime: (Date.now() - BOOT_TIME_MS) / 1000,
    });
  });

  return app;
}

/**
 * A pre-built default instance for `worker.ts` to delegate to. Tests can
 * still call `createApiApp()` directly to get a fresh instance per test.
 */
export const apiApp = createApiApp();
