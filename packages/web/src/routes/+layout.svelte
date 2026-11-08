<script lang="ts">
	import '../app.css';
	import favicon from '$lib/assets/favicon.svg';
	import Icon from '@iconify/svelte';
	import { onMount } from 'svelte';
	import { page } from '$app/state';
	import { afterNavigate } from '$app/navigation';
	import Sidebar from '$lib/components/hub/Sidebar.svelte';
	import ConfirmDialog from '$lib/components/hub/ConfirmDialog.svelte';
	import { hub, inboxFromPath, notifyNewMail } from '$lib/stores/hub.svelte';
	import { fetchInbox } from '$lib/api';
	import { apiFetch } from '$lib/auth-fetch';
	import { APP_NAME } from '$lib/config';

	let { children } = $props();
	let drawer = $state(false);

	afterNavigate(() => (drawer = false));

	async function checkHealth() {
		try {
			const r = await apiFetch('/api/health');
			hub.apiOnline = r.ok;
		} catch {
			hub.apiOnline = false;
		}
	}

	let polling = false;

	/** Polls every saved mailbox for its total, to show unread badges in the sidebar. */
	async function pollCounts() {
		if (polling) return; // previous pass still running on a slow server
		polling = true;
		try {
			const list = [...hub.mailboxes];
			// A few at a time, not one by one and not all at once.
			for (let i = 0; i < list.length; i += 4) {
				await Promise.all(
					list.slice(i, i + 4).map(async (m) => {
						if (m.address === inboxFromPath(page.url.pathname)) return; // open inbox updates itself
						try {
							const data = await fetchInbox(m.address, 1, 1);
							// Re-check: the user may have opened this inbox while we waited.
							if (m.address === inboxFromPath(page.url.pathname)) return;
							const fresh = hub.setTotal(m.address, data.pagination.totalEmails);
							if (fresh > 0) notifyNewMail(APP_NAME, m.label || m.address, fresh, favicon);
						} catch {
							/* server down: the health dot shows it */
						}
					})
				);
			}
		} finally {
			polling = false;
		}
	}

	onMount(() => {
		hub.init();
		checkHealth();
		pollCounts();
	});

	// Re-created when the refresh setting changes.
	$effect(() => {
		// Sidebar checks less often than the open inbox to keep request count low.
		const sec = Math.max(15, hub.settings.refreshSeconds * 2 || 30);
		const timer = setInterval(async () => {
			checkHealth();
			await hub.sync(); // pick up mailboxes added/changed on another device
			pollCounts();
		}, sec * 1000);
		return () => clearInterval(timer);
	});
</script>

<svelte:head>
	<link rel="icon" href={favicon} />
	<title>{APP_NAME}</title>
</svelte:head>

<div class="h-dvh flex overflow-hidden">
	<!-- Desktop sidebar -->
	<div class="hidden lg:block w-72 shrink-0">
		<Sidebar />
	</div>

	<!-- Mobile drawer -->
	{#if drawer}
		<button
			class="lg:hidden fixed inset-0 z-40 bg-[#030712]/65 backdrop-blur-sm hub-backdrop"
			aria-label="Закрыть меню"
			onclick={() => (drawer = false)}
		></button>
		<div
			class="lg:hidden fixed inset-y-0 left-0 z-50 w-72 max-w-[85vw] hub-slide-in shadow-[24px_0_60px_-20px_rgb(0_0_0/0.8)]"
		>
			<Sidebar onnavigate={() => (drawer = false)} />
		</div>
	{/if}

	<div class="flex-1 min-w-0 flex flex-col">
		<!-- Mobile top bar -->
		<header
			class="lg:hidden flex items-center gap-2.5 px-2.5 h-14 shrink-0 border-b border-[var(--hub-line)] bg-[#08101f]/85 backdrop-blur-xl"
		>
			<button
				class="hub-btn hub-btn-ghost hub-btn-icon w-11 h-11 text-[var(--hub-text)]"
				aria-label="Меню"
				aria-expanded={drawer}
				onclick={() => (drawer = true)}
			>
				<Icon icon="lucide:menu" class="text-xl" />
			</button>
			<a href="/" class="flex items-center gap-2.5 min-w-0 rounded-lg">
				<img src={favicon} alt="" class="w-7 h-7 drop-shadow-[0_4px_10px_rgb(37_99_235/0.45)]" width="28" height="28" />
				<span class="font-bold tracking-tight truncate">{APP_NAME}</span>
			</a>
			{#if hub.apiOnline === false}
				<span class="ml-auto hub-chip bg-red-500/15 text-red-300" role="status">
					<span class="w-1.5 h-1.5 rounded-full bg-red-400"></span>
					нет связи
				</span>
			{/if}
		</header>

		<main class="flex-1 min-h-0 overflow-y-auto hub-scroll">
			{@render children()}
		</main>
	</div>
</div>

<ConfirmDialog />

<style>
	.hub-backdrop {
		animation: hub-backdrop 0.2s ease-out;
	}
	@keyframes hub-backdrop {
		from {
			opacity: 0;
		}
	}
</style>
