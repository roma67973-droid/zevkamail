import { browser } from '$app/environment';

let redirecting = false;
// Coming back with the Back button (page restored from bfcache): allow a new redirect.
if (browser) addEventListener('pageshow', (e) => e.persisted && (redirecting = false));

/**
 * fetch for /api calls from the browser. When the site's password session has
 * expired (or the password was changed), the gate answers 401 "Login required":
 * go to the login page and throw, so callers keep their unsent changes instead
 * of treating the 401 as "server rejected it for good".
 */
export async function apiFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
	const r = await fetch(input, init);
	if (r.status === 401 && browser) {
		const body = (await r.clone().json().catch(() => null)) as { error?: string } | null;
		if (body?.error === 'Login required') {
			if (!redirecting) {
				redirecting = true;
				const next = encodeURIComponent(location.pathname + location.search);
				location.href = `/login?next=${next}`;
			}
			throw new Error('Login required');
		}
	}
	return r;
}
