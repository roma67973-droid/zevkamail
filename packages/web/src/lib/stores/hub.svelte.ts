/**
 * Client-side state of mail-hub: saved mailboxes and settings.
 *
 * The API has no "list of my addresses" — any address on the domain just
 * receives mail (catch-all). So the list of mailboxes the user cares about
 * lives in the browser (localStorage). On the server render it is empty and
 * fills in after hydration.
 */
import { browser } from '$app/environment';
import { apiFetch } from '$lib/auth-fetch';

export type MailboxKind = 'temp' | 'permanent';

export interface Mailbox {
	address: string;
	kind: MailboxKind;
	label?: string;
	createdAt: number;
	/** How many emails the user has already seen (for the unread badge). */
	seen: number;
	/** Last known total from the API. */
	total: number;
	/** Last time the mailbox was opened. */
	lastUsedAt?: number;
	/** Local changes not yet saved on the server: 'new' = upload if missing. */
	dirty?: ('new' | 'kind' | 'label')[];
	/** When kind/label was last changed on this device. */
	localEditAt?: number;
	/** Came from the server, counters not known yet: the first count marks existing mail as seen. */
	baseline?: boolean;
}

/** Shape returned by GET /api/mailboxes. */
interface ServerMailbox {
	address: string;
	kind: MailboxKind;
	label: string | null;
	createdAt: number;
	updatedAt: number;
}

export type Accent = 'blue' | 'indigo' | 'cyan' | 'violet' | 'emerald';

export interface Settings {
	/** Auto-refresh period in seconds, 0 = off. */
	refreshSeconds: number;
	defaultKind: MailboxKind;
	accent: Accent;
	/** Show the "code found" chip for registration codes. */
	detectCodes: boolean;
	/** Desktop notification when new mail arrives. */
	notify: boolean;
	/** Days after which an unused temporary mailbox disappears from the list. */
	tempKeepDays: number;
}

const DEFAULT_SETTINGS: Settings = {
	refreshSeconds: 10,
	defaultKind: 'temp',
	accent: 'blue',
	detectCodes: true,
	notify: false,
	tempKeepDays: 1
};

export const ACCENTS: Record<Accent, { name: string; c: string; h: string; t: string }> = {
	blue: { name: 'Синий', c: '#2563eb', h: '#3b82f6', t: '#7db4ff' },
	indigo: { name: 'Индиго', c: '#4f46e5', h: '#6366f1', t: '#a5b4fc' },
	cyan: { name: 'Бирюза', c: '#0891b2', h: '#06b6d4', t: '#67e8f9' },
	violet: { name: 'Фиолет', c: '#7c3aed', h: '#8b5cf6', t: '#c4b5fd' },
	emerald: { name: 'Изумруд', c: '#059669', h: '#10b981', t: '#6ee7b7' }
};

const MB_KEY = 'mailhub.mailboxes.v1';
const ST_KEY = 'mailhub.settings.v1';
const DEL_KEY = 'mailhub.deleted.v1';
const SYNCED_KEY = 'mailhub.synced.v1';

function load<T>(key: string, fallback: T): T {
	if (!browser) return fallback;
	try {
		const raw = localStorage.getItem(key);
		return raw ? (JSON.parse(raw) as T) : fallback;
	} catch {
		return fallback;
	}
}

/** Set by forgetDevice(): nothing may be written to localStorage any more. */
let forgotten = false;

function save(key: string, value: unknown) {
	if (!browser || forgotten) return;
	try {
		localStorage.setItem(key, JSON.stringify(value));
	} catch {
		/* private mode / quota: keep working in memory */
	}
}

class Hub {
	mailboxes = $state<Mailbox[]>([]);
	settings = $state<Settings>({ ...DEFAULT_SETTINGS });
	apiOnline = $state<boolean | null>(null);
	ready = $state(false);

	/** Server sync works (false while the server is unreachable). */
	synced = $state(false);
	private deleted: string[] = [];
	private syncing = false;
	/** Requests for one address run strictly one after another (PUT/DELETE order). */
	private queues = new Map<string, Promise<unknown>>();
	/** address -> when it was removed in this tab (so a running sync can't bring it back). */
	private removedAt = new Map<string, number>();

	init() {
		if (!browser || this.ready) return;
		this.reload();
		// Another tab changed the list or settings: take its version.
		window.addEventListener('storage', (e) => {
			if (e.key === MB_KEY || e.key === ST_KEY || e.key === DEL_KEY) this.reload();
		});
		this.ready = true;
		void this.sync();
	}

	private reload() {
		const st = load<Partial<Settings>>(ST_KEY, {});
		this.settings = { ...DEFAULT_SETTINGS, ...(st && typeof st === 'object' ? st : {}) };
		const list = load<unknown>(MB_KEY, []);
		this.mailboxes = Array.isArray(list)
			? (list as Mailbox[]).filter((m) => m && typeof m.address === 'string')
			: [];
		const del = load<unknown>(DEL_KEY, []);
		this.deleted = Array.isArray(del) ? del.filter((x) => typeof x === 'string') : [];
		this.applyAccent();
	}

	private persist() {
		save(MB_KEY, this.mailboxes);
		save(DEL_KEY, this.deleted);
	}

	private enqueue<T>(address: string, job: () => Promise<T>): Promise<T> {
		const prev = this.queues.get(address) ?? Promise.resolve();
		const next = prev.catch(() => {}).then(job);
		this.queues.set(address, next);
		void next
			.catch(() => {})
			.finally(() => {
				if (this.queues.get(address) === next) this.queues.delete(address);
			});
		return next;
	}

	/**
	 * Two-way sync with the server list:
	 *  1. send local changes that didn't reach the server (offline edits, deletions);
	 *  2. take the server list, but keep local versions that are still unsent
	 *     or were edited while this sync ran, plus local-only counters;
	 *  3. drop temporary mailboxes unused for N days.
	 * On the very first sync of this browser, local mailboxes are uploaded as
	 * "create if missing" - they never overwrite what another device set.
	 */
	private running: Promise<void> | null = null;

	/** Runs a sync, or waits for the one already running. */
	sync(): Promise<void> {
		if (!browser || forgotten) return Promise.resolve();
		if (!this.running) this.running = this.doSync().finally(() => (this.running = null));
		return this.running;
	}

	private async doSync() {
		if (this.syncing) return;
		this.syncing = true;
		const startedAt = Date.now();
		try {
			if (!load<boolean>(SYNCED_KEY, false)) {
				for (const m of this.mailboxes) {
					if (!m.dirty?.length) this.update(m.address, { dirty: ['new'] });
				}
			}
			await Promise.all([
				...this.deleted.map((a) => this.enqueue(a, () => this.sendDelete(a))),
				...this.mailboxes
					.filter((m) => m.dirty?.length)
					.map((m) => this.enqueue(m.address, () => this.send(m.address)))
			]);

			const res = await apiFetch('/api/mailboxes');
			if (!res.ok) throw new Error(String(res.status));
			const server = ((await res.json()) as { mailboxes: ServerMailbox[] }).mailboxes;

			const local = new Map(this.mailboxes.map((m) => [m.address, m]));
			const gone = (a: string) =>
				this.deleted.includes(a) || (this.removedAt.get(a) ?? 0) >= startedAt;
			const fresh = (m: Mailbox) => !!m.dirty?.length || (m.localEditAt ?? 0) >= startedAt;

			const merged: Mailbox[] = [];
			for (const s of server) {
				if (gone(s.address)) continue;
				const l = local.get(s.address);
				if (l && fresh(l)) {
					merged.push(l); // unsent / just-edited local version wins until it is sent
					continue;
				}
				merged.push({
					address: s.address,
					kind: s.kind,
					label: s.label ?? undefined,
					createdAt: s.createdAt,
					seen: l?.seen ?? 0,
					total: l?.total ?? 0,
					lastUsedAt: Math.max(l?.lastUsedAt ?? 0, s.updatedAt),
					localEditAt: l?.localEditAt,
					// New on this device: don't show all its old mail as unread.
					baseline: l ? l.baseline : true
				});
			}
			for (const m of this.mailboxes) {
				if (!gone(m.address) && fresh(m) && !merged.some((x) => x.address === m.address))
					merged.unshift(m);
			}
			this.mailboxes = merged;
			save(SYNCED_KEY, true);
			this.synced = true;
			this.persist();
			this.expireTemp();
		} catch {
			this.synced = false; // server down: keep working from the local copy
		} finally {
			this.syncing = false;
		}
	}

	/**
	 * Send the unsent fields of one mailbox. Only changed fields go to the
	 * server, so e.g. renaming on one device can't undo pinning on another.
	 * Network/5xx errors and 401 (logged out) keep the change for the next sync;
	 * other 4xx drop it.
	 */
	private async send(address: string) {
		const m = this.find(address);
		if (!m?.dirty?.length) return;
		const dirty = [...m.dirty];
		const editAt = m.localEditAt;
		const body: Record<string, unknown> = {};
		if (dirty.includes('kind')) body.kind = m.kind;
		if (dirty.includes('label')) body.label = m.label ?? null;
		if (dirty.includes('new')) {
			body.createdAt = m.createdAt;
			if (!('kind' in body)) body.kind = m.kind;
			if (!('label' in body) && m.label) body.label = m.label;
			if (dirty.length === 1) body.ifAbsent = true; // plain upload: don't overwrite the server
		}
		let ok = false;
		try {
			const r = await apiFetch(`/api/mailboxes/${encodeURIComponent(address)}`, {
				method: 'PUT',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify(body)
			});
			ok = r.ok || permanentFailure(r.status); // e.g. 400: retrying won't help
		} catch {
			/* offline / logged out */
		}
		const now = this.find(address);
		// Clear only if nothing was edited again while the request was in flight.
		if (ok && now && now.localEditAt === editAt) this.update(address, { dirty: undefined });
	}

	private async sendDelete(address: string) {
		try {
			const r = await apiFetch(`/api/mailboxes/${encodeURIComponent(address)}`, { method: 'DELETE' });
			if (r.ok || permanentFailure(r.status)) {
				this.deleted = this.deleted.filter((x) => x !== address);
				this.persist();
			}
		} catch {
			/* stays in `deleted`, retried on next sync */
		}
	}

	/** Tell the server the mailbox is in use (keeps it from expiring on other devices). */
	private touch(address: string) {
		void this.enqueue(address, () =>
			apiFetch(`/api/mailboxes/${encodeURIComponent(address)}`, {
				method: 'PUT',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ touch: true })
			}).catch(() => {})
		);
	}

	private expireTemp() {
		const cutoff = Date.now() - this.settings.tempKeepDays * 86400_000;
		for (const m of this.mailboxes) {
			if (m.kind === 'temp' && !m.dirty?.length && (m.lastUsedAt ?? m.createdAt) < cutoff)
				this.remove(m.address);
		}
	}

	get temp() {
		return this.mailboxes.filter((m) => m.kind === 'temp');
	}

	get permanent() {
		return this.mailboxes.filter((m) => m.kind === 'permanent');
	}

	find(address: string) {
		const a = address.toLowerCase();
		return this.mailboxes.find((m) => m.address === a);
	}

	add(address: string, kind: MailboxKind = this.settings.defaultKind) {
		const a = address.toLowerCase();
		const existing = this.find(a);
		if (existing) return existing;
		const mb: Mailbox = {
			address: a,
			kind,
			createdAt: Date.now(),
			lastUsedAt: Date.now(),
			seen: 0,
			total: 0,
			dirty: ['new'],
			localEditAt: Date.now()
		};
		this.deleted = this.deleted.filter((x) => x !== a);
		this.removedAt.delete(a);
		this.mailboxes = [mb, ...this.mailboxes];
		this.persist();
		void this.enqueue(a, () => this.send(a));
		return mb;
	}

	remove(address: string) {
		const a = address.toLowerCase();
		this.mailboxes = this.mailboxes.filter((m) => m.address !== a);
		if (!this.deleted.includes(a)) this.deleted = [...this.deleted, a];
		this.removedAt.set(a, Date.now());
		this.persist();
		void this.enqueue(a, () => this.sendDelete(a));
	}

	setKind(address: string, kind: MailboxKind) {
		this.edit(address, 'kind', { kind });
	}

	setLabel(address: string, label: string) {
		this.edit(address, 'label', { label: label.trim() || undefined });
	}

	private edit(address: string, field: 'kind' | 'label', patch: Partial<Mailbox>) {
		const a = address.toLowerCase();
		const m = this.find(a);
		if (!m) return;
		const dirty = m.dirty?.includes(field) ? m.dirty : [...(m.dirty ?? []), field];
		this.update(a, { ...patch, dirty, localEditAt: Date.now() });
		void this.enqueue(a, () => this.send(a));
	}

	/** Record the latest total from the API. Returns how many are new since last call. */
	setTotal(address: string, total: number) {
		const mb = this.find(address);
		if (!mb) return 0;
		if (mb.baseline) {
			this.update(address, { total, seen: total, baseline: undefined });
			return 0;
		}
		const fresh = Math.max(0, total - mb.total);
		// Mail expires by TTL: when the total drops, don't let `seen` hide new mail.
		if (total !== mb.total) this.update(address, { total, seen: Math.min(mb.seen, total) });
		return fresh;
	}

	markSeen(address: string, total: number) {
		const mb = this.find(address);
		if (!mb) return;
		const hour = 3600_000;
		const stale = Date.now() - (mb.lastUsedAt ?? 0) > hour;
		if (mb.seen !== total || mb.total !== total || stale || mb.baseline)
			this.update(address, { seen: total, total, lastUsedAt: Date.now(), baseline: undefined });
		if (stale) this.touch(mb.address);
	}

	unread(m: Mailbox) {
		return Math.max(0, m.total - m.seen);
	}

	private update(address: string, patch: Partial<Mailbox>) {
		const a = address.toLowerCase();
		this.mailboxes = this.mailboxes.map((m) => (m.address === a ? { ...m, ...patch } : m));
		this.persist();
	}

	saveSettings(patch: Partial<Settings>) {
		this.settings = { ...this.settings, ...patch };
		save(ST_KEY, this.settings);
		this.applyAccent();
	}

	clearAll() {
		for (const m of [...this.mailboxes]) this.remove(m.address);
	}

	/** Changes made on this device that the server doesn't have yet. */
	get unsentCount() {
		return this.mailboxes.filter((m) => m.dirty?.length).length + this.deleted.length;
	}

	/**
	 * Before logging out: push unsent changes (a few seconds max).
	 * Returns false if some changes are still unsent (caller asks the user).
	 */
	async flushBeforeLogout(): Promise<boolean> {
		if (!browser) return true;
		await Promise.race([this.sync(), new Promise((r) => setTimeout(r, 4000))]);
		await Promise.race([
			Promise.allSettled([...this.queues.values()]),
			new Promise((r) => setTimeout(r, 2000))
		]);
		return this.unsentCount === 0;
	}

	/** Forget this device's copy of the list and settings; no more writes after this. */
	forgetDevice() {
		if (!browser) return;
		forgotten = true;
		this.mailboxes = [];
		this.deleted = [];
		for (const k of [MB_KEY, DEL_KEY, SYNCED_KEY, ST_KEY]) {
			try {
				localStorage.removeItem(k);
			} catch {
				/* ignore */
			}
		}
	}

	private applyAccent() {
		if (!browser) return;
		const a = ACCENTS[this.settings.accent] ?? ACCENTS.blue;
		const s = document.documentElement.style;
		s.setProperty('--hub-accent', a.c);
		s.setProperty('--hub-accent-hover', a.h);
		s.setProperty('--hub-accent-text', a.t);
	}
}

/** 4xx that won't get better on retry. 401 = logged out (retry after login), 408/429 = try later. */
function permanentFailure(status: number) {
	return status >= 400 && status < 500 && status !== 401 && status !== 408 && status !== 429;
}

// NOTE: module singleton — shared by all SSR requests. Only touch it in the
// browser (onMount / $effect / event handlers), never from `load` or SSR code.
export const hub = new Hub();

export { findCode } from '$lib/utils/code';

/** Mailbox address from the current URL, or ''. */
export function inboxFromPath(pathname: string): string {
	if (!pathname.startsWith('/inbox/')) return '';
	try {
		return decodeURIComponent(pathname.slice('/inbox/'.length)).toLowerCase();
	} catch {
		return '';
	}
}

export const ADDRESS_RE = /^[a-z0-9][a-z0-9._+-]{0,63}@[a-z0-9.-]+$/i;

export function plural(n: number, one: string, few: string, many: string) {
	const a = n % 100;
	const b = n % 10;
	if (a >= 11 && a <= 14) return many;
	if (b === 1) return one;
	if (b >= 2 && b <= 4) return few;
	return many;
}

let lastNotify = 0;
/** Desktop notification about new mail (respects the setting, skips focused tab). */
export function notifyNewMail(appName: string, who: string, n: number, icon: string) {
	if (!browser || !hub.settings.notify || typeof Notification === 'undefined') return;
	if (Notification.permission !== 'granted' || document.hasFocus()) return;
	if (Date.now() - lastNotify < 2000) return;
	lastNotify = Date.now();
	new Notification(`${appName}: новое письмо`, { body: `${who} — ${n} нов.`, icon });
}
