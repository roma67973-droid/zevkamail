<script lang="ts">
	import Icon from '@iconify/svelte';
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import { hub, inboxFromPath, type Mailbox } from '$lib/stores/hub.svelte';
	import { APP_NAME } from '$lib/config';
	import logo from '$lib/assets/favicon.svg';
	import { ask } from '$lib/stores/dialog.svelte';
	import Avatar from './Avatar.svelte';

	interface Props {
		onnavigate?: () => void;
	}
	let { onnavigate }: Props = $props();

	let current = $derived(inboxFromPath(page.url.pathname));

	function open(m: Mailbox) {
		onnavigate?.();
		goto(`/inbox/${encodeURIComponent(m.address)}`);
	}

	async function remove(e: Event, m: Mailbox) {
		e.stopPropagation();
		const ok = await ask({
			title: `Убрать ${m.label || m.address} из списка?`,
			text:
				m.kind === 'permanent'
					? 'Письма останутся, но начнут удаляться через сутки. Почта на этот адрес продолжит приходить.'
					: 'Письма останутся до конца срока хранения. Почта на этот адрес продолжит приходить.',
			ok: 'Убрать',
			danger: true,
			icon: 'lucide:list-x'
		});
		if (!ok) return;
		// Leave the inbox first, otherwise its page would re-add the mailbox.
		if (current === m.address) await goto('/');
		hub.remove(m.address);
	}

	function onRowKey(e: KeyboardEvent, m: Mailbox) {
		if (e.target !== e.currentTarget) return; // key pressed on the inner × button
		if (e.key === 'Enter' || e.key === ' ') {
			e.preventDefault();
			open(m);
		}
	}

	const sections = $derived([
		{ title: 'Постоянные', icon: 'lucide:star', items: hub.permanent, empty: 'Закрепи ящик звёздочкой' },
		{ title: 'Одноразовые', icon: 'lucide:timer', items: hub.temp, empty: 'Пока пусто' }
	]);
</script>

<aside
	class="h-full flex flex-col gap-4 p-3.5 bg-[#08101f]/92 backdrop-blur-xl border-r border-[var(--hub-line)]
		shadow-[inset_-1px_0_0_rgb(255_255_255/0.02)]"
>
	<a
		href="/"
		onclick={() => onnavigate?.()}
		class="group flex items-center gap-3 px-2 pt-1.5 pb-0.5 rounded-xl"
	>
		<span class="relative shrink-0">
			<span
				class="absolute inset-0 rounded-xl bg-[var(--hub-accent)] opacity-40 blur-md transition-opacity group-hover:opacity-70"
				aria-hidden="true"
			></span>
			<img src={logo} alt="" class="relative w-9 h-9" width="36" height="36" />
		</span>
		<span class="leading-tight min-w-0">
			<span class="block font-bold text-[17px] tracking-tight">{APP_NAME}</span>
			<span class="block text-xs text-[var(--hub-muted)]">почтовый хаб</span>
		</span>
	</a>

	<a href="/" onclick={() => onnavigate?.()} class="hub-btn hub-btn-primary w-full min-h-11">
		<Icon icon="lucide:plus" class="text-lg" />
		Новый адрес
	</a>

	<nav class="flex-1 overflow-y-auto hub-scroll -mx-1.5 px-1.5 flex flex-col gap-5 pt-1" aria-label="Ящики">
		{#each sections as s (s.title)}
			<div>
				<div class="flex items-center justify-between px-2 mb-1.5">
					<span class="hub-label flex items-center gap-1.5">
						<Icon icon={s.icon} class="text-[13px] {s.title === 'Постоянные' ? 'text-amber-300/80' : ''}" />{s.title}
					</span>
					{#if s.items.length}
						<span class="text-[11px] font-semibold tabular-nums px-1.5 py-px rounded-md bg-white/5 text-[var(--hub-muted)]">
							{s.items.length}
						</span>
					{/if}
				</div>
				{#if !hub.ready}
					<div class="flex flex-col gap-1.5 px-1" aria-hidden="true">
						{#each [0, 1] as i (i)}
							<div class="flex items-center gap-2.5 px-1.5 py-1.5">
								<div class="w-8 h-8 rounded-[30%] hub-skeleton"></div>
								<div class="flex-1 h-3 hub-skeleton {i ? 'max-w-[55%]' : 'max-w-[75%]'}"></div>
							</div>
						{/each}
					</div>
				{:else if s.items.length === 0}
					<p class="mx-1 px-3 py-2.5 text-[13px] text-[#6178a0] rounded-xl border border-dashed border-[var(--hub-line)]/80">
						{s.empty}
					</p>
				{:else}
					<ul class="flex flex-col gap-0.5">
						{#each s.items as m (m.address)}
							{@const active = current === m.address}
							{@const unread = hub.unread(m)}
							{@const local = m.address.split('@')[0]}
							<li>
								<div
									role="button"
									tabindex="0"
									aria-current={active ? 'page' : undefined}
									onclick={() => open(m)}
									onkeydown={(e) => onRowKey(e, m)}
									class="group relative w-full flex items-center gap-2.5 pl-2 pr-2 py-1.5 min-h-11 rounded-xl text-sm cursor-pointer transition-colors
										{active
										? 'bg-[var(--hub-accent)]/15 text-white ring-1 ring-inset ring-[color:var(--hub-accent)]/35'
										: 'text-[#c4d1e8] hover:bg-white/[0.05] hover:text-white'}"
								>
									{#if active}
										<span
											class="absolute -left-1.5 top-2 bottom-2 w-[3px] rounded-r-full bg-[var(--hub-accent-text)]"
											aria-hidden="true"
										></span>
									{/if}
									<span class="relative shrink-0">
										<Avatar name={m.label || local} seed={m.address} size={32} square />
										{#if m.kind === 'permanent'}
											<span
												class="absolute -right-1 -bottom-1 w-4 h-4 rounded-full grid place-items-center bg-[#08101f] text-amber-300"
												title="Постоянный"
											>
												<Icon icon="mdi:star" class="text-[11px]" />
											</span>
										{/if}
									</span>
									<span class="flex-1 min-w-0 leading-tight">
										<span class="block truncate {unread > 0 ? 'font-semibold text-white' : 'font-medium'}">{m.label || local}</span>
										{#if m.label}
											<span class="block truncate text-xs text-[var(--hub-muted)] font-mono mt-0.5">{local}</span>
										{/if}
									</span>
									{#if unread > 0}
										<span class="hub-badge" aria-label="Новых писем: {unread}">{unread}</span>
									{/if}
									<button
										onclick={(e) => remove(e, m)}
										title="Убрать из списка"
										aria-label="Убрать {m.label || m.address} из списка"
										class="w-7 h-7 -mr-1 grid place-items-center rounded-lg shrink-0 [@media(hover:hover)]:opacity-0 group-hover:opacity-100 focus-visible:opacity-100
											text-[var(--hub-muted)] hover:text-red-300 hover:bg-red-500/15 transition"
									>
										<Icon icon="lucide:x" />
									</button>
								</div>
							</li>
						{/each}
					</ul>
				{/if}
			</div>
		{/each}

		<div>
			<div class="px-2 mb-1.5 hub-label flex items-center gap-1.5">
				<Icon icon="lucide:plug" class="text-[13px]" />Подключить
			</div>
			<ul class="flex flex-col gap-0.5">
				{#each [{ n: 'Gmail', i: 'logos:google-gmail' }, { n: 'Яндекс Почта', i: 'fa-brands:yandex-international' }] as p (p.n)}
					<li class="flex items-center gap-2.5 px-2 py-1.5 min-h-11 rounded-xl text-sm text-[#7d8fb0] cursor-not-allowed">
						<span class="w-8 h-8 rounded-[30%] grid place-items-center bg-white/[0.04] ring-1 ring-inset ring-white/5 shrink-0 opacity-80">
							<Icon icon={p.i} class="text-base {p.n === 'Gmail' ? '' : 'text-red-500'}" />
						</span>
						<span class="flex-1">{p.n}</span>
						<span class="text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded-md bg-white/5 text-[var(--hub-muted)]">скоро</span>
					</li>
				{/each}
			</ul>
		</div>
	</nav>

	<div class="border-t border-[var(--hub-line)] pt-3 flex flex-col gap-2">
		<a
			href="/settings"
			onclick={() => onnavigate?.()}
			aria-current={page.url.pathname === '/settings' ? 'page' : undefined}
			class="flex items-center gap-2.5 px-2 py-1.5 min-h-11 rounded-xl text-sm transition-colors
				{page.url.pathname === '/settings' ? 'bg-white/10 text-white' : 'text-[#c4d1e8] hover:bg-white/5 hover:text-white'}"
		>
			<span class="w-8 h-8 rounded-[30%] grid place-items-center bg-white/[0.04] ring-1 ring-inset ring-white/5">
				<Icon icon="lucide:settings" class="text-[var(--hub-muted)]" />
			</span>
			Настройки
		</a>
		<div
			class="mx-1 flex items-center gap-2 px-2.5 py-1.5 rounded-lg bg-white/[0.03] text-xs text-[var(--hub-muted)]"
			role="status"
		>
			<span class="relative flex w-2 h-2 shrink-0">
				{#if hub.apiOnline}
					<span class="absolute inset-0 rounded-full bg-emerald-400 hub-ring"></span>
				{/if}
				<span
					class="relative w-2 h-2 rounded-full {hub.apiOnline === null
						? 'bg-zinc-500'
						: hub.apiOnline
							? 'bg-emerald-400 shadow-[0_0_8px] shadow-emerald-400'
							: 'bg-red-500'}"
				></span>
			</span>
			{hub.apiOnline === null ? 'Проверка сервера…' : hub.apiOnline ? 'Сервер на связи' : 'Сервер недоступен'}
		</div>
	</div>
</aside>
