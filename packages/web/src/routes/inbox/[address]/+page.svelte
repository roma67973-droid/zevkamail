<script lang="ts">
	import Icon from '@iconify/svelte';
	import { invalidateAll } from '$app/navigation';
	import { deleteEmail, deleteInbox } from '$lib/api';
	import { untrack } from 'svelte';
	import { hub, findCode, notifyNewMail, plural, ADDRESS_RE } from '$lib/stores/hub.svelte';
	import { ask } from '$lib/stores/dialog.svelte';
	import { copyToClipboard } from '$lib/utils/clipboard';
	import { APP_NAME } from '$lib/config';
	import favicon from '$lib/assets/favicon.svg';
	import type { Email } from '$lib/types';
	import Avatar from '$lib/components/hub/Avatar.svelte';

	let { data } = $props();

	let address = $derived(data.address.toLowerCase());
	let mailbox = $derived(hub.find(address));
	let emails = $derived(data.emails as Email[]);
	let total = $derived(data.pagination.totalEmails as number);

	let selectedId = $state<string | null>(null);
	let selected = $derived(emails.find((e) => e.id === selectedId) ?? null);
	let refreshing = $state(false);
	let toast = $state('');
	let editingLabel = $state(false);
	let labelDraft = $state('');
	let showImages = $state(false);
	let toastTimer: ReturnType<typeof setTimeout> | undefined;

	// Opening an inbox puts it in the sidebar list — once per address, so that
	// removing it from the sidebar doesn't bring it straight back.
	$effect(() => {
		const a = address;
		if (!hub.ready) return;
		untrack(() => {
			if (ADDRESS_RE.test(a) && !hub.find(a)) hub.add(a);
		});
	});

	// Mark mail as seen; notify when auto-refresh brings new mail to a background tab.
	let prevTotal: { a: string; n: number } | null = null;
	$effect(() => {
		const a = address;
		const n = total;
		void mailbox?.baseline; // re-run when this mailbox arrives from another device while open
		if (!hub.ready) return;
		untrack(() => {
			if (prevTotal && prevTotal.a === a && n > prevTotal.n) {
				notifyNewMail(APP_NAME, mailbox?.label || a, n - prevTotal.n, favicon);
			}
			prevTotal = { a, n };
			hub.markSeen(a, n);
		});
	});

	// Reset selection when switching mailbox.
	$effect(() => {
		address;
		untrack(() => {
			selectedId = null;
			editingLabel = false;
			showImages = false;
		});
	});

	// Auto refresh.
	$effect(() => {
		const sec = hub.settings.refreshSeconds;
		if (!sec) return;
		const t = setInterval(() => invalidateAll(), sec * 1000);
		return () => clearInterval(t);
	});

	function flash(msg: string) {
		toast = msg;
		clearTimeout(toastTimer);
		toastTimer = setTimeout(() => (toast = ''), 1800);
	}

	async function copy(text: string, what = 'Скопировано') {
		if (await copyToClipboard(text)) flash(what);
	}

	async function refresh() {
		refreshing = true;
		await invalidateAll();
		setTimeout(() => (refreshing = false), 400);
	}

	async function removeAll() {
		const ok = await ask({
			title: 'Удалить все письма?',
			text: `Все письма в ${address} будут удалены навсегда. Сам адрес останется в списке.`,
			ok: 'Удалить всё',
			danger: true
		});
		if (!ok) return;
		try {
			await deleteInbox(address);
		} catch {
			return flash('Не удалось удалить — сервер недоступен');
		}
		selectedId = null;
		await invalidateAll();
		flash('Ящик очищен');
	}

	async function removeOne(e: Email) {
		try {
			await deleteEmail(e.id);
		} catch {
			return flash('Не удалось удалить — сервер недоступен');
		}
		if (selectedId === e.id) selectedId = null;
		await invalidateAll();
		flash('Письмо удалено');
	}

	function togglePermanent() {
		if (!mailbox) return;
		const kind = mailbox.kind === 'permanent' ? 'temp' : 'permanent';
		hub.setKind(address, kind);
		flash(kind === 'permanent' ? 'Закреплён — письма хранятся вечно' : 'Снова одноразовый — письма удалятся через сутки');
	}

	function startLabel() {
		labelDraft = mailbox?.label ?? '';
		editingLabel = true;
	}

	function saveLabel() {
		hub.setLabel(address, labelDraft);
		editingLabel = false;
	}

	function sender(from: string) {
		const m = from.match(/^\s*"?([^"<@]+?)"?\s*</);
		return m ? m[1].trim() : from.replace(/[<>]/g, '').split('@')[0];
	}

	function senderEmail(from: string) {
		const m = from.match(/<([^>]+)>/);
		return m ? m[1] : from;
	}

	const rtf = new Intl.RelativeTimeFormat('ru', { numeric: 'auto' });
	function ago(iso: string) {
		const s = Math.round((new Date(iso).getTime() - Date.now()) / 1000);
		if (s > -45) return 'сейчас';
		if (s > -3600) return rtf.format(Math.round(s / 60), 'minute');
		if (s > -86400) return rtf.format(Math.round(s / 3600), 'hour');
		return rtf.format(Math.round(s / 86400), 'day');
	}

	function fullDate(iso: string) {
		return new Date(iso).toLocaleString('ru', { dateStyle: 'medium', timeStyle: 'short' });
	}

	function code(e: Email) {
		if (!hub.settings.detectCodes) return null;
		// HTML-only mail has no text part: search the HTML with tags removed.
		const text =
			e.text ||
			(e.html ?? '')
				.replace(/<(style|script)[\s\S]*?<\/\1>/gi, ' ')
				.replace(/<[^>]+>/g, ' ')
				.replace(/&nbsp;/g, ' ');
		return findCode(e.subject ?? '', text);
	}

	/**
	 * Email HTML for a sandboxed iframe (no scripts, no same-origin).
	 * Our <head> goes first so the document is in standards mode and our CSP
	 * applies: remote images/styles (tracking pixels) are blocked unless the
	 * user clicks "show images". Meta refresh is cut out — it could navigate
	 * the frame to a phishing page.
	 */
	function srcdoc(e: Email, images: boolean) {
		if (!e.html) return '';
		const remote = images ? ' https: http:' : '';
		const csp =
			`default-src 'none'; img-src data: cid:${remote}; style-src 'unsafe-inline'${remote}; ` +
			`font-src data:${remote}; form-action 'none'`;
		const head =
			'<!DOCTYPE html><html><head><meta charset="utf-8">' +
			`<meta http-equiv="Content-Security-Policy" content="${csp}">` +
			'<meta name="referrer" content="no-referrer"><meta name="color-scheme" content="light">' +
			'<base target="_blank"></head><body>';
		const body = e.html
			.replace(/<!doctype[^>]*>/gi, '')
			.replace(/<meta[^>]*http-equiv\s*=\s*["']?\s*refresh[^>]*>/gi, '');
		return head + body + '</body></html>';
	}

	function hasRemoteImages(e: Email) {
		return !!e.html && /<img[^>]+src\s*=\s*["']?https?:|url\(\s*["']?https?:/i.test(e.html);
	}
</script>

<svelte:head>
	<title>{address} — {APP_NAME}</title>
</svelte:head>

<div class="h-full flex flex-col">
	<!-- Mailbox header -->
	<div
		class="px-3 sm:px-4 md:px-6 py-3 md:py-4 border-b border-[var(--hub-line)] flex items-center gap-3 bg-[#0a1323]/70 backdrop-blur-xl"
	>
		<div class="relative shrink-0 hidden sm:block">
			<Avatar name={mailbox?.label || address} seed={address} size={44} square />
			<span
				class="absolute -right-1.5 -bottom-1.5 w-5 h-5 rounded-full grid place-items-center bg-[#0a1323] ring-1 ring-[var(--hub-line)]
					{mailbox?.kind === 'permanent' ? 'text-amber-300' : 'hub-accent-text'}"
				title={mailbox?.kind === 'permanent' ? 'Постоянный' : 'Одноразовый'}
			>
				<Icon icon={mailbox?.kind === 'permanent' ? 'mdi:star' : 'lucide:timer'} class="text-[11px]" />
			</span>
		</div>

		<div class="min-w-0 flex-1">
			{#if editingLabel}
				<form onsubmit={(e) => { e.preventDefault(); saveLabel(); }} class="flex gap-2 max-w-sm">
					<!-- svelte-ignore a11y_autofocus -->
					<input class="hub-input py-1.5" bind:value={labelDraft} placeholder="Например: Steam" autofocus onblur={saveLabel} />
				</form>
			{:else}
				<button
					onclick={startLabel}
					class="group flex items-center gap-2 text-left max-w-full rounded-md"
					title="Подписать ящик"
				>
					<span class="font-semibold text-base md:text-lg truncate {mailbox?.label ? '' : 'text-[var(--hub-muted)] italic'}">
						{mailbox?.label || 'Без подписи'}
					</span>
					<Icon
						icon="lucide:pencil"
						class="shrink-0 text-sm text-[var(--hub-muted)] opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100 [@media(hover:none)]:opacity-60 transition-opacity"
					/>
				</button>
			{/if}
			<button
				onclick={() => copy(address, 'Адрес скопирован')}
				class="group/addr flex items-center gap-1.5 font-mono text-[13px] md:text-sm text-[var(--hub-muted)] hover:text-white transition-colors max-w-full rounded-md"
				title="Скопировать адрес"
			>
				<span class="truncate">{address}</span>
				<Icon icon="lucide:copy" class="shrink-0 opacity-60 group-hover/addr:opacity-100" />
			</button>
		</div>

		<div class="flex items-center gap-1.5 sm:gap-2 shrink-0">
			<button
				class="hub-btn hub-btn-primary max-sm:w-10 max-sm:px-0"
				onclick={() => copy(address, 'Адрес скопирован')}
				aria-label="Копировать адрес"
			>
				<Icon icon="lucide:copy" />
				<span class="hidden sm:inline">Копировать</span>
			</button>
			<button
				class="hub-btn hub-btn-icon {mailbox?.kind === 'permanent' ? 'text-amber-300 border-amber-400/40 bg-amber-400/10 hover:bg-amber-400/15 hover:border-amber-400/60' : ''}"
				onclick={togglePermanent}
				title={mailbox?.kind === 'permanent' ? 'Сделать одноразовым' : 'Закрепить как постоянный'}
				aria-label={mailbox?.kind === 'permanent' ? 'Сделать одноразовым' : 'Закрепить как постоянный'}
				aria-pressed={mailbox?.kind === 'permanent'}
			>
				<Icon icon={mailbox?.kind === 'permanent' ? 'mdi:star' : 'lucide:star'} />
			</button>
			<button class="hub-btn hub-btn-icon" onclick={refresh} title="Обновить" aria-label="Обновить">
				<Icon icon="lucide:refresh-cw" class={refreshing ? 'animate-spin' : ''} />
			</button>
			<button
				class="hub-btn hub-btn-icon hub-btn-danger"
				onclick={removeAll}
				title="Удалить все письма"
				aria-label="Удалить все письма"
				disabled={total === 0}
			>
				<Icon icon="lucide:trash-2" />
			</button>
		</div>
	</div>

	<!-- Body: list + reader -->
	<div class="flex-1 min-h-0 flex">
		<!-- List -->
		<section
			class="w-full md:w-[22rem] xl:w-[26rem] shrink-0 border-r border-[var(--hub-line)] flex flex-col min-h-0
				{selected ? 'hidden md:flex' : 'flex'}"
		>
			<div
				class="px-4 h-10 shrink-0 flex items-center justify-between gap-3 text-xs text-[var(--hub-muted)] border-b border-[var(--hub-line)] bg-white/[0.015]"
			>
				<span class="truncate">
					<b class="text-[var(--hub-text)] tabular-nums">{total}</b> {plural(total, 'письмо', 'письма', 'писем')}
					{#if total > emails.length}<span class="opacity-70"> · показаны последние {emails.length}</span>{/if}
				</span>
				{#if hub.settings.refreshSeconds}
					<span class="flex items-center gap-1.5 shrink-0" title="Автообновление">
						<span class="relative flex w-1.5 h-1.5">
							<span class="absolute inset-0 rounded-full bg-emerald-400 hub-ring"></span>
							<span class="relative w-1.5 h-1.5 rounded-full bg-emerald-400"></span>
						</span>
						авто · {hub.settings.refreshSeconds} с
					</span>
				{/if}
			</div>

			<div class="flex-1 overflow-y-auto hub-scroll">
				{#if emails.length === 0}
					<div class="h-full min-h-80 flex flex-col items-center justify-center text-center p-8 gap-5">
						<div class="relative hub-float">
							<div class="absolute inset-0 rounded-3xl bg-[var(--hub-accent)]/35 blur-2xl"></div>
							<span class="absolute inset-0 rounded-3xl ring-2 ring-[color:var(--hub-accent)]/40 hub-ring" aria-hidden="true"></span>
							<div class="relative w-20 h-20 rounded-3xl hub-card grid place-items-center">
								<Icon icon="lucide:inbox" class="text-4xl hub-accent-text" />
							</div>
						</div>
						<div>
							<p class="font-semibold text-lg">Ждём письма…</p>
							<p class="text-sm text-[var(--hub-muted)] mt-1.5 max-w-64 leading-relaxed">
								Укажи этот адрес при регистрации — письмо появится здесь само.
							</p>
						</div>
						<button
							class="hub-btn max-w-full"
							onclick={() => copy(address, 'Адрес скопирован')}
						>
							<Icon icon="lucide:copy" class="shrink-0" />
							<span class="font-mono text-[13px] truncate min-w-0">{address}</span>
						</button>
					</div>
				{:else}
					<ul class="p-2 flex flex-col gap-1">
						{#each emails as e (e.id)}
							{@const c = code(e)}
							{@const name = sender(e.from)}
							{@const sel = selectedId === e.id}
							<li>
								<button
									onclick={() => {
										selectedId = e.id;
										showImages = false;
									}}
									aria-current={sel ? 'true' : undefined}
									class="relative w-full text-left px-3 py-3 flex gap-3 rounded-xl transition-colors
										{sel
										? 'bg-[var(--hub-accent)]/12 ring-1 ring-inset ring-[color:var(--hub-accent)]/35'
										: 'hover:bg-white/[0.04]'}"
								>
									{#if sel}
										<span class="absolute left-0 top-3 bottom-3 w-[3px] rounded-r-full bg-[var(--hub-accent-text)]" aria-hidden="true"></span>
									{/if}
									<Avatar {name} seed={senderEmail(e.from)} size={40} />
									<span class="flex-1 min-w-0">
										<span class="flex items-baseline justify-between gap-2">
											<span class="font-semibold truncate {sel ? 'text-white' : ''}">{name}</span>
											<time class="text-[11px] text-[var(--hub-muted)] shrink-0 tabular-nums" datetime={e.receivedAt} title={fullDate(e.receivedAt)}>
												{ago(e.receivedAt)}
											</time>
										</span>
										<span class="block text-sm truncate text-[#c4d1e8] mt-0.5">{e.subject || '(без темы)'}</span>
										<span class="flex items-center gap-2 mt-1.5 min-w-0">
											{#if c}
												<span
													class="shrink-0 inline-flex items-center gap-1 text-[11px] font-mono font-bold px-1.5 py-0.5 rounded-md bg-emerald-500/15 text-emerald-300 ring-1 ring-inset ring-emerald-500/30"
												>
													<Icon icon="lucide:key-round" class="text-[10px]" />{c}
												</span>
											{/if}
											<span class="text-xs text-[#6b80a6] truncate">{(e.text ?? '').slice(0, 90)}</span>
										</span>
									</span>
								</button>
							</li>
						{/each}
					</ul>
				{/if}
			</div>
		</section>

		<!-- Reader -->
		<section class="flex-1 min-w-0 flex-col min-h-0 {selected ? 'flex' : 'hidden md:flex'}">
			{#if selected}
				{@const c = code(selected)}
				{@const name = sender(selected.from)}
				<div class="px-4 py-4 md:p-6 border-b border-[var(--hub-line)] hub-pop bg-white/[0.01]">
					<div class="flex items-start gap-2 sm:gap-3">
						<button
							class="hub-btn hub-btn-ghost hub-btn-icon -ml-1.5 md:hidden"
							onclick={() => (selectedId = null)}
							aria-label="Назад"
						>
							<Icon icon="lucide:arrow-left" class="text-lg" />
						</button>
						<div class="flex-1 min-w-0">
							<h1 class="text-lg sm:text-xl md:text-2xl font-semibold leading-snug break-words tracking-tight">
								{selected.subject || '(без темы)'}
							</h1>
						</div>
						<button
							class="hub-btn hub-btn-icon hub-btn-danger"
							onclick={() => selected && removeOne(selected)}
							title="Удалить письмо"
							aria-label="Удалить письмо"
						>
							<Icon icon="lucide:trash-2" />
						</button>
					</div>

					<div class="flex items-center gap-3 mt-4">
						<Avatar {name} seed={senderEmail(selected.from)} size={40} />
						<div class="min-w-0 flex-1 text-sm">
							<div class="flex flex-wrap items-baseline gap-x-2 min-w-0">
								<b class="truncate">{name}</b>
								<span class="text-[var(--hub-muted)] truncate text-[13px]">&lt;{senderEmail(selected.from)}&gt;</span>
							</div>
							<div class="text-xs text-[var(--hub-muted)] mt-0.5 flex flex-wrap gap-x-1.5">
								<time datetime={selected.receivedAt}>{fullDate(selected.receivedAt)}</time>
								<span aria-hidden="true">·</span>
								<span class="truncate max-w-full">кому: <span class="font-mono">{selected.to}</span></span>
							</div>
						</div>
					</div>

					{#if c}
						<button
							onclick={() => copy(c, 'Код скопирован')}
							class="group mt-4 w-full sm:w-auto flex items-center gap-3 sm:gap-4 pl-3 pr-4 py-3 rounded-2xl text-left transition
								bg-linear-to-br from-emerald-500/15 to-emerald-500/5 ring-1 ring-inset ring-emerald-500/35
								hover:from-emerald-500/20 hover:ring-emerald-400/60 shadow-[0_14px_30px_-18px] shadow-emerald-500/60"
							title="Скопировать код"
						>
							<span class="w-11 h-11 rounded-xl grid place-items-center bg-emerald-500/15 text-emerald-300 shrink-0">
								<Icon icon="lucide:key-round" class="text-2xl" />
							</span>
							<span class="min-w-0">
								<span class="block text-[11px] text-emerald-300/80 uppercase tracking-wider font-semibold">Код из письма</span>
								<span class="block font-mono text-2xl font-bold tracking-[0.2em] text-emerald-100 break-all">{c}</span>
							</span>
							<span
								class="ml-auto shrink-0 flex items-center gap-1.5 text-sm font-medium text-emerald-200 px-2.5 py-1.5 rounded-lg bg-emerald-500/15 group-hover:bg-emerald-500/25 transition-colors"
							>
								<Icon icon="lucide:copy" /> <span class="hidden min-[400px]:inline">копировать</span>
							</span>
						</button>
					{/if}
				</div>

				<div class="flex-1 min-h-0 p-3 sm:p-4 md:p-6">
					{#if selected.html}
						<div class="h-full flex flex-col gap-2">
							{#if hasRemoteImages(selected) && !showImages}
								<div
									class="flex items-center gap-3 text-sm pl-3 pr-1.5 py-1.5 rounded-xl bg-white/[0.04] ring-1 ring-inset ring-white/5 text-[var(--hub-muted)]"
								>
									<Icon icon="lucide:image-off" class="shrink-0" />
									<span class="flex-1 leading-snug text-[13px]">Внешние картинки скрыты — отправитель не узнает, что письмо открыто</span>
									<button class="hub-btn shrink-0 min-h-9 py-1" onclick={() => (showImages = true)}>Показать</button>
								</div>
							{/if}
							<iframe
								title="Письмо"
								srcdoc={srcdoc(selected, showImages)}
								sandbox="allow-popups allow-popups-to-escape-sandbox"
								referrerpolicy="no-referrer"
								class="w-full flex-1 min-h-[400px] rounded-xl bg-white border border-[var(--hub-line)] shadow-[0_20px_50px_-30px_rgb(0_0_0/0.9)]"
							></iframe>
						</div>
					{:else}
						<pre class="whitespace-pre-wrap break-words font-sans text-[15px] leading-relaxed text-[#d5deee] hub-card p-5">{selected.text}</pre>
					{/if}
				</div>
			{:else}
				<div class="h-full flex flex-col items-center justify-center text-center gap-4 p-8 text-[var(--hub-muted)]">
					<div class="w-20 h-20 rounded-3xl grid place-items-center bg-white/[0.03] ring-1 ring-inset ring-white/5">
						<Icon icon="lucide:mail-open" class="text-4xl opacity-50" />
					</div>
					<div>
						<p class="font-medium text-[var(--hub-text)]/80">{emails.length ? 'Выбери письмо слева' : 'Здесь появится письмо'}</p>
						{#if emails.length && hub.settings.detectCodes}
							<p class="text-sm mt-1 opacity-80">Коды подтверждения подсвечиваются автоматически</p>
						{/if}
					</div>
				</div>
			{/if}
		</section>
	</div>
</div>

<div
	class="fixed left-1/2 -translate-x-1/2 z-50 pointer-events-none bottom-[max(1.5rem,env(safe-area-inset-bottom))] w-max max-w-[calc(100vw-2rem)]"
	role="status"
	aria-live="polite"
>
	{#if toast}
		{@const bad = toast.startsWith('Не удалось')}
		<div
			class="hub-pop pl-2.5 pr-4 py-2 rounded-full bg-[#14223f]/95 backdrop-blur-xl border shadow-[0_20px_40px_-12px_rgb(0_0_0/0.8)] text-sm flex items-center gap-2.5
				{bad ? 'border-red-500/40' : 'border-[#34508a]'}"
		>
			<span
				class="w-6 h-6 rounded-full grid place-items-center shrink-0 {bad ? 'bg-red-500/20 text-red-300' : 'bg-emerald-500/20 text-emerald-300'}"
			>
				<Icon icon={bad ? 'lucide:wifi-off' : 'lucide:check'} class="text-sm" />
			</span>
			{toast}
		</div>
	{/if}
</div>
