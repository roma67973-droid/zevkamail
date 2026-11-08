<script lang="ts">
	import Icon from '@iconify/svelte';
	import { goto } from '$app/navigation';
	import { onMount } from 'svelte';
	import { hub, plural, type MailboxKind } from '$lib/stores/hub.svelte';
	import { generateRandomPrefix } from '$lib/utils/generateAddress';
	import { APP_NAME, EMAIL_DOMAIN, NO_REAL_DOMAIN } from '$lib/config';
	import { page } from '$app/state';
	import Avatar from '$lib/components/hub/Avatar.svelte';

	// Generated in the browser only, so the name doesn't flicker on hydration.
	let prefix = $state('');
	onMount(() => {
		if (!prefix) prefix = generateRandomPrefix();
	});
	let kind = $state<MailboxKind>('temp');
	let label = $state('');
	let kindTouched = false;

	// Follow the default from settings until the user picks a type by hand.
	$effect(() => {
		if (hub.ready && !kindTouched) kind = hub.settings.defaultKind;
	});

	const VALID = /^[a-z0-9][a-z0-9._+-]{0,63}$/;
	let clean = $derived(prefix.trim().toLowerCase());
	let valid = $derived(VALID.test(clean));
	let address = $derived(`${clean}@${EMAIL_DOMAIN}`);
	let exists = $derived(valid && !!hub.find(address));

	function create(e?: SubmitEvent) {
		e?.preventDefault();
		if (!valid) return;
		hub.add(address, kind);
		if (label.trim()) hub.setLabel(address, label);
		goto(`/inbox/${encodeURIComponent(address)}`);
	}

	function quick() {
		const a = `${generateRandomPrefix()}@${EMAIL_DOMAIN}`;
		hub.add(a, 'temp');
		goto(`/inbox/${encodeURIComponent(a)}`);
	}

	function pick(k: MailboxKind) {
		kind = k;
		kindTouched = true;
	}

	let recent = $derived([...hub.mailboxes].sort((a, b) => hub.unread(b) - hub.unread(a)).slice(0, 6));
</script>

<svelte:head>
	<title>Новый адрес — {APP_NAME}</title>
</svelte:head>

<div class="max-w-4xl mx-auto px-4 md:px-8 py-7 md:py-14">
	<div class="mb-7 md:mb-10 hub-pop">
		{#if NO_REAL_DOMAIN && page.url.hostname !== 'localhost'}
			<div
				class="flex items-start gap-3 rounded-2xl border border-amber-400/30 bg-linear-to-br from-amber-400/12 to-amber-400/[0.04] text-amber-200 px-4 py-3.5 mb-6 text-sm"
				role="note"
			>
				<span class="w-8 h-8 rounded-lg grid place-items-center bg-amber-400/15 shrink-0">
					<Icon icon="lucide:triangle-alert" class="text-lg" />
				</span>
				<div class="leading-relaxed">
					<b class="text-amber-100">Домен ещё не подключён</b> — письма на адреса @{EMAIL_DOMAIN} не придут.
					Интерфейс работает, почта заработает, когда к сайту подключат свой домен.
				</div>
			</div>
		{:else}
			<div class="hub-chip hub-chip-accent mb-4 max-w-full">
				<span class="relative flex w-1.5 h-1.5 shrink-0">
					<span class="absolute inset-0 rounded-full bg-[var(--hub-accent-text)] hub-ring"></span>
					<span class="relative w-1.5 h-1.5 rounded-full bg-[var(--hub-accent-text)]"></span>
				</span>
				<span class="truncate">любой адрес @{EMAIL_DOMAIN} уже работает</span>
			</div>
		{/if}
		<h1 class="text-[1.9rem] leading-[1.15] md:text-5xl md:leading-[1.1] font-bold tracking-tight">
			Создай адрес <span class="hub-gradient-text">за секунду</span>
		</h1>
		<p class="text-[var(--hub-muted)] mt-3 max-w-xl leading-relaxed md:text-[17px]">
			Придумай любое имя — письма на него сразу попадут сюда. Одноразовый для быстрых регистраций,
			постоянный — для того, что нужно сохранить.
		</p>
	</div>

	<div class="relative">
		<!-- Мягкое свечение за формой в цвет акцента -->
		<div
			class="pointer-events-none absolute inset-x-0 sm:-inset-x-6 -top-6 h-40 rounded-full bg-[var(--hub-accent)]/20 blur-3xl"
			aria-hidden="true"
		></div>

		<form onsubmit={create} class="relative hub-card p-4 sm:p-5 md:p-7 flex flex-col gap-6">
			<div>
				<label for="prefix" class="hub-label block mb-2">Имя ящика</label>
				<div class="flex gap-2">
					<div class="hub-field flex-1 min-w-0">
						<span class="hidden sm:grid place-items-center pl-4 text-[var(--hub-muted)]" aria-hidden="true">
							<Icon icon="lucide:at-sign" class="text-lg" />
						</span>
						<input
							id="prefix"
							bind:value={prefix}
							autocomplete="off"
							spellcheck="false"
							autocapitalize="off"
							class="flex-1 min-w-0 bg-transparent outline-none px-4 sm:pl-2.5 py-3.5 text-lg font-mono"
							placeholder="steam.shop"
						/>
						<span
							class="hidden sm:flex items-center px-4 font-mono text-[var(--hub-muted)] border-l border-[var(--hub-line)] bg-white/[0.02] rounded-r-[13px]"
						>
							@{EMAIL_DOMAIN}
						</span>
					</div>
					<button
						type="button"
						class="hub-btn hub-btn-icon w-14 h-auto rounded-[14px] group"
						title="Случайное имя"
						aria-label="Случайное имя"
						onclick={() => (prefix = generateRandomPrefix())}
					>
						<Icon icon="lucide:dices" class="text-xl transition-transform duration-300 group-hover:rotate-12 group-active:rotate-90" />
					</button>
				</div>
				<p
					class="text-xs mt-2 min-h-4 flex items-center gap-1.5 break-all {valid || !clean ? 'text-[var(--hub-muted)]' : 'text-red-400'}"
					aria-live="polite"
				>
					{#if !clean}
						Латиница, цифры, точка, дефис
					{:else if !valid}
						<Icon icon="lucide:circle-alert" class="shrink-0" />
						Только латиница, цифры и . _ + - (начинается с буквы или цифры)
					{:else if exists}
						<Icon icon="lucide:inbox" class="shrink-0 hub-accent-text" />
						Этот ящик уже в списке — откроется он
					{:else}
						<Icon icon="lucide:circle-check" class="shrink-0 text-emerald-400" />
						<span class="font-mono text-[var(--hub-text)]/90">{address}</span>
					{/if}
				</p>
			</div>

			<div>
				<span class="hub-label block mb-2" id="kind-label">Тип ящика</span>
				<div class="grid sm:grid-cols-2 gap-3" role="group" aria-labelledby="kind-label">
					{#each [{ k: 'temp', i: 'lucide:timer', t: 'Одноразовый', d: `Исчезнет из списка через ${hub.settings.tempKeepDays} дн.` }, { k: 'permanent', i: 'lucide:star', t: 'Постоянный', d: 'Письма хранятся вечно, есть на всех устройствах' }] as o (o.k)}
						{@const on = kind === o.k}
						<button
							type="button"
							aria-pressed={on}
							onclick={() => pick(o.k as MailboxKind)}
							class="relative flex items-start gap-3 p-4 rounded-2xl border text-left transition
								{on
								? 'border-[color:var(--hub-accent)] bg-[var(--hub-accent)]/10 ring-1 ring-[color:var(--hub-accent)]/40 shadow-[0_12px_30px_-18px] shadow-[color:var(--hub-accent)]'
								: 'border-[var(--hub-line)] bg-white/[0.015] hover:bg-white/[0.04] hover:border-[#34508a]'}"
						>
							<span
								class="w-10 h-10 rounded-xl grid place-items-center shrink-0 transition-colors
									{on
									? o.k === 'permanent'
										? 'bg-amber-400/15 text-amber-300'
										: 'bg-[var(--hub-accent)]/20 hub-accent-text'
									: 'bg-white/5 text-[var(--hub-muted)]'}"
							>
								<Icon icon={o.k === 'permanent' && on ? 'mdi:star' : o.i} class="text-xl" />
							</span>
							<span class="flex-1 min-w-0 pr-6">
								<span class="block font-semibold">{o.t}</span>
								<span class="block text-sm text-[var(--hub-muted)] leading-snug mt-0.5">{o.d}</span>
							</span>
							<span
								class="absolute top-4 right-4 w-5 h-5 rounded-full grid place-items-center border transition
									{on ? 'bg-[var(--hub-accent)] border-transparent text-white' : 'border-[#34508a]'}"
								aria-hidden="true"
							>
								{#if on}<Icon icon="lucide:check" class="text-xs" />{/if}
							</span>
						</button>
					{/each}
				</div>
			</div>

			<div>
				<label for="label" class="hub-label block mb-2">Подпись <span class="normal-case tracking-normal font-normal opacity-80">(необязательно)</span></label>
				<div class="relative">
					<Icon icon="lucide:tag" class="absolute left-3.5 top-1/2 -translate-y-1/2 text-[var(--hub-muted)] pointer-events-none" />
					<input id="label" class="hub-input pl-10" bind:value={label} placeholder="Например: Steam, Discord, магазин" />
				</div>
			</div>

			<div class="flex flex-col sm:flex-row gap-3 pt-1">
				<button type="submit" class="hub-btn hub-btn-primary flex-1 min-h-12 text-base group" disabled={!valid}>
					{exists ? 'Открыть ящик' : 'Создать и открыть'}
					<Icon icon="lucide:arrow-right" class="text-lg transition-transform group-hover:translate-x-0.5" />
				</button>
				<button type="button" class="hub-btn min-h-12" onclick={quick}>
					<Icon icon="lucide:zap" class="text-amber-300" /> Случайный в 1 клик
				</button>
			</div>
		</form>
	</div>

	{#if recent.length}
		<section class="mt-10 md:mt-12">
			<div class="flex items-center justify-between mb-3">
				<h2 class="hub-label">Твои ящики</h2>
				<span class="text-xs text-[var(--hub-muted)] tabular-nums">{hub.mailboxes.length}</span>
			</div>
			<div class="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
				{#each recent as m (m.address)}
					{@const unread = hub.unread(m)}
					{@const local = m.address.split('@')[0]}
					<a
						href="/inbox/{encodeURIComponent(m.address)}"
						class="hub-card hub-card-link p-4 flex items-center gap-3 group min-w-0"
					>
						<span class="relative shrink-0">
							<Avatar name={m.label || local} seed={m.address} size={40} square />
							{#if m.kind === 'permanent'}
								<span
									class="absolute -right-1 -bottom-1 w-[18px] h-[18px] rounded-full grid place-items-center bg-[var(--hub-surface)] text-amber-300"
									title="Постоянный"
								>
									<Icon icon="mdi:star" class="text-xs" />
								</span>
							{/if}
						</span>
						<span class="flex-1 min-w-0">
							<span class="flex items-center gap-2">
								<span class="font-semibold truncate">{m.label || local}</span>
								{#if unread}
									<span class="hub-badge ml-auto shrink-0">{unread} нов.</span>
								{/if}
							</span>
							<span class="block text-xs font-mono text-[var(--hub-muted)] truncate mt-0.5">{m.address}</span>
							{#if !unread}
								<span class="block text-[11px] text-[#6b80a6] mt-1">
									{m.total} {plural(m.total, 'письмо', 'письма', 'писем')}
								</span>
							{/if}
						</span>
						<Icon
							icon="lucide:chevron-right"
							class="shrink-0 text-[var(--hub-muted)] opacity-0 -translate-x-1 transition group-hover:opacity-100 group-hover:translate-x-0"
						/>
					</a>
				{/each}
			</div>
		</section>
	{/if}
</div>
