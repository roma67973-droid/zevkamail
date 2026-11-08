import type { Handle } from '@sveltejs/kit';
import { denied, handleLogin, isLoggedIn, logout } from '$lib/server/gate';

export const handle: Handle = async ({ event, resolve }) => {
	// Password lock (only when the SITE_PASSWORD secret is set).
	const env = (event.platform as any)?.env;
	const password: string | undefined = env?.SITE_PASSWORD;
	// Deployed on Cloudflare (API binding present) without a password: fail closed,
	// otherwise the proxy below would hand out the API key to anyone.
	if (!password && env?.API && !env?.ALLOW_OPEN_SITE) {
		return new Response('SITE_PASSWORD is not set', { status: 503 });
	}
	if (password) {
		const path = event.url.pathname;
		if (path === '/login') return handleLogin(event.request, event.url, password);
		if (path === '/logout') return logout(event.request);
		if (!(await isLoggedIn(event.request, password))) return denied(event.url);
	}

	if (event.url.pathname.startsWith('/api/')) {
		const api = (event.platform as any)?.env?.API;
		if (api) {
			// Forward via service binding. Host is irrelevant — bindings route by name.
			const forwarded = new Request(
				`https://api.internal${event.url.pathname}${event.url.search}`,
				event.request,
			);
			// The browser never sees the API key: the web Worker adds it here.
			const key = (event.platform as any)?.env?.API_KEY;
			if (key) forwarded.headers.set('X-API-Key', key);
			return api.fetch(forwarded);
		}
		// adapter-node fallback (Docker path): let SvelteKit's normal routing
		// miss the request, which 404s. Docker users hit the API at PUBLIC_API_URL
		// directly, so this branch never matters in practice.
	}
	return resolve(event);
};
