/**
 * Password lock for the whole site (used when Cloudflare Access isn't set up).
 * Enabled when the SITE_PASSWORD secret is set. A session cookie holds
 * `<expiresMs>.<hmac>`; the HMAC key is the password itself, so changing the
 * password logs every device out.
 */

const COOKIE = 'mh_session';
const SESSION_DAYS = 30;

const enc = new TextEncoder();

async function hmac(secret: string, data: string): Promise<string> {
	const key = await crypto.subtle.importKey(
		'raw',
		enc.encode(secret),
		{ name: 'HMAC', hash: 'SHA-256' },
		false,
		['sign']
	);
	const sig = new Uint8Array(await crypto.subtle.sign('HMAC', key, enc.encode(data)));
	return btoa(String.fromCharCode(...sig)).replace(/[+/=]/g, (c) => ({ '+': '-', '/': '_', '=': '' })[c]!);
}

function safeEqual(a: string, b: string): boolean {
	const x = enc.encode(a);
	const y = enc.encode(b);
	let diff = x.length ^ y.length;
	for (let i = 0; i < y.length; i++) diff |= (x[i] ?? 0) ^ y[i];
	return diff === 0;
}

function readCookie(req: Request, name: string): string | null {
	const header = req.headers.get('cookie') ?? '';
	for (const part of header.split(';')) {
		const [k, ...v] = part.trim().split('=');
		if (k === name) return v.join('=');
	}
	return null;
}

export async function isLoggedIn(req: Request, password: string): Promise<boolean> {
	const value = readCookie(req, COOKIE);
	if (!value) return false;
	const [exp, sig] = value.split('.');
	if (!exp || !sig || !(Number(exp) > Date.now())) return false;
	return safeEqual(sig, await hmac(password, exp));
}

/** Only same-site paths, never `//evil.com` (also with tabs/backslashes the browser would strip). */
function safeNext(next: string | null): string {
	if (!next || !next.startsWith('/') || /[\x00-\x1f\\]/.test(next)) return '/';
	try {
		const base = 'https://gate.invalid';
		const u = new URL(next, base);
		return u.origin === base ? u.pathname + u.search : '/';
	} catch {
		return '/';
	}
}

export async function handleLogin(req: Request, url: URL, password: string): Promise<Response> {
	if (req.method === 'POST') {
		const form = await req.formData().catch(() => null);
		// Pasted passwords often carry a space or line break at the ends.
		const given = String(form?.get('password') ?? '').trim();
		const next = safeNext(String(form?.get('next') ?? '/'));
		if (given && safeEqual(given, password.trim())) {
			const exp = String(Date.now() + SESSION_DAYS * 86400_000);
			const cookie = `${COOKIE}=${exp}.${await hmac(password, exp)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${SESSION_DAYS * 86400}`;
			return new Response(null, { status: 303, headers: { location: next, 'set-cookie': cookie } });
		}
		// Slow down guessing.
		await new Promise((r) => setTimeout(r, 1500));
		return loginPage(next, true, 401);
	}
	return loginPage(safeNext(url.searchParams.get('next')), false, 200);
}

/** POST only, so another site can't log the user out with <img src="/logout">. */
export function logout(req: Request): Response {
	if (req.method !== 'POST') {
		return new Response(null, { status: 303, headers: { location: '/settings' } });
	}
	return new Response(null, {
		status: 303,
		headers: {
			location: '/login',
			'set-cookie': `${COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`
		}
	});
}

/** Not logged in: pages go to /login, API calls get 401. */
export function denied(url: URL): Response {
	if (url.pathname.startsWith('/api/')) {
		return new Response(JSON.stringify({ error: 'Login required' }), {
			status: 401,
			headers: { 'content-type': 'application/json' }
		});
	}
	const next = encodeURIComponent(url.pathname + url.search);
	return new Response(null, { status: 303, headers: { location: `/login?next=${next}` } });
}

function esc(s: string): string {
	return s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

function loginPage(next: string, wrong: boolean, status: number): Response {
	const html = `<!DOCTYPE html>
<html lang="ru"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex">
<meta name="theme-color" content="#0b1426">
<meta name="color-scheme" content="dark">
<title>Вход — zevkamail</title>
<style>
*{box-sizing:border-box}
html,body{height:100%}
body{margin:0;min-height:100dvh;display:grid;place-items:center;padding:20px 16px;
font-family:'General Sans',system-ui,-apple-system,Segoe UI,Roboto,sans-serif;color:#e6edf7;
-webkit-font-smoothing:antialiased;-webkit-tap-highlight-color:transparent;
background:radial-gradient(900px 480px at 85% -12%,rgb(37 99 235/.22) 0%,transparent 65%),
radial-gradient(1200px 600px at 30% -10%,#16305e 0%,transparent 60%),#0b1426;background-attachment:fixed}
.wrap{width:100%;max-width:380px;animation:pop .35s cubic-bezier(.2,.8,.2,1) both}
.glow{position:relative}
.glow:before{content:"";position:absolute;inset:-40px -20px auto;height:160px;border-radius:999px;
background:rgb(37 99 235/.22);filter:blur(48px);pointer-events:none}
form{position:relative;width:100%;border:1px solid #263a63;border-radius:20px;padding:28px 24px 24px;
background:linear-gradient(180deg,rgb(255 255 255/.035),transparent 40%),rgb(17 29 53/.85);
backdrop-filter:blur(10px);-webkit-backdrop-filter:blur(10px);
box-shadow:inset 0 1px 0 rgb(255 255 255/.04),0 30px 70px -30px rgb(0 0 0/.85)}
.logo{display:flex;align-items:center;gap:12px;margin-bottom:24px}
.mark{position:relative;flex-shrink:0;width:44px;height:44px}
.mark:before{content:"";position:absolute;inset:0;border-radius:12px;background:#2563eb;opacity:.45;filter:blur(12px)}
.mark svg{position:relative;display:block}
.name{display:block;font-weight:700;font-size:19px;letter-spacing:-.01em;line-height:1.15}
.sub{display:block;font-size:12.5px;color:#8ea2c4;margin-top:2px}
h1{margin:0 0 4px;font-size:22px;font-weight:700;letter-spacing:-.015em}
.hint{margin:0 0 20px;font-size:14px;color:#8ea2c4;line-height:1.45}
label{display:block;font-size:11px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:#8ea2c4;margin-bottom:8px}
.field{position:relative}
.field svg{position:absolute;left:13px;top:50%;transform:translateY(-50%);color:#8ea2c4;pointer-events:none}
input{width:100%;min-height:48px;padding:12px 14px 12px 40px;border-radius:12px;border:1px solid #263a63;background:#070e1c;color:#e6edf7;
font:inherit;font-size:16px;outline:none;transition:border-color .15s,box-shadow .15s}
input:hover{border-color:#31497a}
input:focus{border-color:#2563eb;box-shadow:0 0 0 4px rgb(37 99 235/.25)}
input.bad{border-color:rgb(239 68 68/.6)}
button{margin-top:16px;width:100%;min-height:48px;padding:12px;border:0;border-radius:12px;color:#fff;font:inherit;font-size:15px;font-weight:600;cursor:pointer;
display:flex;align-items:center;justify-content:center;gap:8px;
background:linear-gradient(180deg,#3b82f6,#2563eb);
box-shadow:inset 0 1px 0 rgb(255 255 255/.18),0 12px 28px -12px #2563eb;transition:background .15s,box-shadow .15s,transform .1s}
button:hover{background:#3b82f6;box-shadow:inset 0 1px 0 rgb(255 255 255/.2),0 14px 32px -10px #2563eb}
button:active{transform:translateY(1px)}
button:focus-visible{outline:none;box-shadow:0 0 0 4px rgb(125 180 255/.45)}
.err{display:flex;align-items:center;gap:8px;margin-top:14px;padding:10px 12px;border-radius:12px;
background:rgb(239 68 68/.12);border:1px solid rgb(239 68 68/.3);color:#fca5a5;font-size:13.5px}
.foot{display:flex;align-items:center;justify-content:center;gap:6px;margin-top:16px;font-size:12px;color:#6b80a6}
@keyframes pop{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:none}}
@media (prefers-reduced-motion:reduce){*{animation:none!important;transition:none!important}}
@media (max-width:380px){form{padding:24px 18px 20px}}
</style></head><body>
<main class="wrap glow">
<form method="POST" action="/login">
<div class="logo">
<span class="mark"><svg width="44" height="44" viewBox="0 0 64 64" fill="none" aria-hidden="true"><defs><linearGradient id="g" x1="0" y1="0" x2="64" y2="64" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#3b82f6"/><stop offset="1" stop-color="#1e3a8a"/></linearGradient></defs><rect width="64" height="64" rx="14" fill="url(#g)"/><rect x="13" y="19" width="38" height="27" rx="4" stroke="#fff" stroke-width="3.5"/><path d="M15 22l17 13 17-13" stroke="#fff" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round"/><circle cx="50" cy="18" r="7" fill="#7db4ff" stroke="#0b1426" stroke-width="3"/></svg></span>
<span><span class="name">zevkamail</span><span class="sub">почтовый хаб</span></span>
</div>
<h1>Вход</h1>
<p class="hint">Сайт закрыт паролем. Введи его один раз — устройство запомнится на ${SESSION_DAYS} дней.</p>
<label for="p">Пароль</label>
<div class="field">
<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg>
<input id="p" name="password" type="password" autocomplete="current-password" autofocus required${wrong ? ' class="bad" aria-invalid="true" aria-describedby="err"' : ''}>
</div>
<input type="hidden" name="next" value="${esc(next)}">
<button type="submit">Войти<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6"/></svg></button>
${wrong ? '<div class="err" id="err" role="alert"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><path d="M12 8v4M12 16h.01"/></svg>Неверный пароль</div>' : ''}
</form>
<div class="foot"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>Личный почтовый ящик</div>
</main></body></html>`;
	return new Response(html, {
		status,
		headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' }
	});
}
