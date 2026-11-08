<script lang="ts">
	import Icon from '@iconify/svelte';
	import { hub, ACCENTS, type Accent, type MailboxKind } from '$lib/stores/hub.svelte';
	import { APP_NAME, EMAIL_DOMAIN } from '$lib/config';
	import { ask } from '$lib/stores/dialog.svelte';

	const REFRESH = [
		{ v: 0, t: 'Выкл' },
		{ v: 5, t: '5 с' },
		{ v: 10, t: '10 с' },
		{ v: 30, t: '30 с' },
		{ v: 60, t: '1 мин' }
	];
	const KEEP = [1, 3, 7, 30];

	let notifyHint = $state('');

	async function toggleNotify() {
		if (hub.settings.notify) return hub.saveSettings({ notify: false });
		if (typeof Notification === 'undefined') {
			notifyHint = 'Браузер не поддерживает уведомления';
			return;
		}
		const p = await Notification.requestPermission();
		if (p === 'granted') {
			hub.saveSettings({ notify: true });
			notifyHint = '';
		} else {
			notifyHint = 'Браузер запретил уведомления — разреши их в настройках сайта';
		}
	}

	function exportList() {
		const blob = new Blob([JSON.stringify(hub.mailboxes, null, 2)], { type: 'application/json' });
		const url = URL.createObjectURL(blob);
		const a = document.createElement('a');
		a.href = url;
		a.download = 'zevkamail-mailboxes.json';
		a.click();
		setTimeout(() => URL.revokeObjectURL(url), 1000);
	}

	let logoutForm: HTMLFormElement | undefined = $state();
	let loggingOut = $state(false);

	async function logout(e: SubmitEvent) {
		e.preventDefault();
		if (loggingOut) return;
		loggingOut = true;
		const allSent = await hub.flushBeforeLogout();
		if (
			!allSent &&
			!(await ask({
				title: 'Выйти без сохранения?',
				text: `Не удалось отправить на сервер ${hub.unsentCount} изм. (нет связи). Если выйти сейчас, они пропадут.`,
				ok: 'Всё равно выйти',
				danger: true,
				icon: 'lucide:wifi-off'
			}))
		) {
			loggingOut = false;
			return;
		}
		hub.forgetDevice();
		logoutForm?.submit(); // native POST, the server clears the cookie
	}

	async function clearAll() {
		const ok = await ask({
			title: 'Очистить список ящиков?',
			text: 'Список очистится на всех устройствах. Письма постоянных ящиков снова начнут удаляться через сутки.',
			ok: 'Очистить',
			danger: true
		});
		if (ok) hub.clearAll();
	}
</script>

<svelte:head>
	<title>Настройки — {APP_NAME}</title>
</svelte:head>

{#snippet toggle(on: boolean, onclick: () => void)}
	<button
		type="button"
		role="switch"
		aria-checked={on}
		aria-label="Переключить"
		{onclick}
		class="relative w-12 h-7 rounded-full transition-colors shrink-0
			{on ? 'hub-accent-bg shadow-[0_6px_16px_-6px] shadow-[color:var(--hub-accent)]' : 'bg-[#26385c] hover:bg-[#2d4269]'}"
	>
		<span
			class="absolute top-1 left-1 w-5 h-5 rounded-full bg-white shadow-[0_2px_6px_rgb(0_0_0/0.35)] transition-transform duration-200 {on ? 'translate-x-5' : ''}"
		></span>
	</button>
{/snippet}

{#snippet row(title: string, desc: string)}
	<div class="min-w-0">
		<div class="font-medium">{title}</div>
		<div class="text-sm text-[var(--hub-muted)]">{desc}</div>
	</div>
{/snippet}

{#snippet segmented(opts: { v: any; t: string }[], value: any, set: (v: any) => void)}
	<div class="flex flex-wrap gap-1 p-1 rounded-xl bg-[var(--hub-deep)] border border-[var(--hub-line)] self-start sm:self-auto">
		{#each opts as o (o.t)}
			<button
				type="button"
				aria-pressed={value === o.v}
				onclick={() => set(o.v)}
				class="px-3 min-h-9 rounded-lg text-sm font-medium transition-colors
					{value === o.v
					? 'hub-accent-bg text-white shadow-[inset_0_1px_0_rgb(255_255_255/0.18),0_4px_12px_-6px_rgb(0_0_0/0.6)]'
					: 'text-[var(--hub-muted)] hover:text-white hover:bg-white/5'}"
			>
				{o.t}
			</button>
		{/each}
	</div>
{/snippet}

<div class="max-w-3xl mx-auto px-4 md:px-8 py-8 md:py-12 flex flex-col gap-6">
	<div>
		<h1 class="text-3xl md:text-4xl font-bold tracking-tight">Настройки</h1>
		<p class="text-[var(--hub-muted)] mt-2 leading-relaxed">Настройки — в этом браузере. Список ящиков общий для всех устройств.</p>
	</div>

	<!-- Appearance -->
	<section class="hub-card p-5 md:p-6 flex flex-col gap-5">
		<h2 class="flex items-center gap-3 font-semibold text-[17px]"><span class="hub-tile w-9 h-9"><Icon icon="lucide:palette" /></span> Внешний вид</h2>
		<div class="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
			{@render row('Цвет акцента', 'Кнопки, выделение, бейджи')}
			<div class="flex gap-2.5">
				{#each Object.entries(ACCENTS) as [key, a] (key)}
					{@const on = hub.settings.accent === key}
					<button
						type="button"
						title={a.name}
						aria-label={a.name}
						aria-pressed={on}
						onclick={() => hub.saveSettings({ accent: key as Accent })}
						class="w-9 h-9 rounded-full grid place-items-center text-white transition-transform hover:scale-110
							shadow-[inset_0_1px_0_rgb(255_255_255/0.25)]
							{on ? 'ring-2 ring-white ring-offset-2 ring-offset-[#111d35]' : ''}"
						style="background:linear-gradient(135deg,{a.h},{a.c})"
					>
						{#if on}<Icon icon="lucide:check" class="text-base drop-shadow" />{/if}
					</button>
				{/each}
			</div>
		</div>
	</section>

	<!-- Mail -->
	<section class="hub-card p-5 md:p-6 flex flex-col gap-5 [&>div+div]:border-t [&>div+div]:border-[var(--hub-line)]/60 [&>div+div]:pt-5">
		<h2 class="flex items-center gap-3 font-semibold text-[17px]"><span class="hub-tile w-9 h-9"><Icon icon="lucide:mail" /></span> Почта</h2>

		<div class="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
			{@render row('Автообновление', 'Как часто проверять открытый ящик')}
			{@render segmented(REFRESH, hub.settings.refreshSeconds, (v) => hub.saveSettings({ refreshSeconds: v }))}
		</div>

		<div class="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
			{@render row('Тип нового ящика', 'Что выбрано по умолчанию на главной')}
			{@render segmented(
				[{ v: 'temp', t: 'Одноразовый' }, { v: 'permanent', t: 'Постоянный' }],
				hub.settings.defaultKind,
				(v) => hub.saveSettings({ defaultKind: v })
			)}
		</div>

		<div class="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
			{@render row('Одноразовые живут в списке', 'Потом пропадают из боковой панели')}
			{@render segmented(
				KEEP.map((d) => ({ v: d, t: `${d} дн.` })),
				hub.settings.tempKeepDays,
				(v) => hub.saveSettings({ tempKeepDays: v })
			)}
		</div>

		<div class="flex items-center justify-between gap-4">
			{@render row('Находить коды', 'Подсвечивать код подтверждения из письма')}
			{@render toggle(hub.settings.detectCodes, () => hub.saveSettings({ detectCodes: !hub.settings.detectCodes }))}
		</div>

		<div class="flex items-center justify-between gap-4">
			<div class="min-w-0">
				<div class="font-medium">Уведомления</div>
				<div class="text-sm text-[var(--hub-muted)]">{notifyHint || 'Всплывашка, когда пришло новое письмо, а вкладка в фоне'}</div>
			</div>
			{@render toggle(hub.settings.notify, toggleNotify)}
		</div>
	</section>

	<!-- Connections -->
	<section class="hub-card p-5 md:p-6 flex flex-col gap-4">
		<h2 class="flex items-center gap-3 font-semibold text-[17px]"><span class="hub-tile w-9 h-9"><Icon icon="lucide:plug" /></span> Подключения</h2>
		{#each [{ n: 'Gmail', i: 'logos:google-gmail', d: 'Чтение через IMAP с Raspberry Pi' }, { n: 'Яндекс Почта', i: 'fa-brands:yandex-international', d: 'Чтение через IMAP с Raspberry Pi' }] as p (p.n)}
			<div class="flex items-center gap-4 p-3 rounded-xl border border-[var(--hub-line)] bg-[var(--hub-deep)]/50">
				<div class="w-10 h-10 rounded-lg bg-white/5 grid place-items-center">
					<Icon icon={p.i} class="text-xl {p.n === 'Gmail' ? '' : 'text-red-500'}" />
				</div>
				<div class="flex-1 min-w-0">
					<div class="font-medium">{p.n}</div>
					<div class="text-sm text-[var(--hub-muted)]">{p.d}</div>
				</div>
				<button class="hub-btn" disabled>Скоро</button>
			</div>
		{/each}
	</section>

	<!-- Server -->
	<section class="hub-card p-5 md:p-6 flex flex-col gap-4">
		<h2 class="flex items-center gap-3 font-semibold text-[17px]"><span class="hub-tile w-9 h-9"><Icon icon="lucide:server" /></span> Сервер</h2>
		<dl class="grid grid-cols-[auto_1fr] gap-x-6 gap-y-2.5 text-sm">
			<dt class="text-[var(--hub-muted)]">Домен</dt>
			<dd class="font-mono">@{EMAIL_DOMAIN}</dd>
			<dt class="text-[var(--hub-muted)]">Статус</dt>
			<dd class="flex items-center gap-2">
				<span class="w-2 h-2 rounded-full {hub.apiOnline ? 'bg-emerald-400' : hub.apiOnline === false ? 'bg-red-500' : 'bg-zinc-500'}"></span>
				{hub.apiOnline ? 'на связи' : hub.apiOnline === false ? 'недоступен' : 'проверка…'}
			</dd>
			<dt class="text-[var(--hub-muted)]">Хранение писем</dt>
			<dd>одноразовые — по <span class="font-mono">EMAIL_TTL_SECONDS</span> (сейчас сутки), постоянные — вечно</dd>
			<dt class="text-[var(--hub-muted)]">Список ящиков</dt>
			<dd>{hub.synced ? 'синхронизирован с сервером — одинаковый на всех устройствах' : 'сервер недоступен, показана копия из браузера'}</dd>
		</dl>
	</section>

	<!-- Data -->
	<section class="hub-card p-5 md:p-6 flex flex-col gap-5 [&>div+div]:border-t [&>div+div]:border-[var(--hub-line)]/60 [&>div+div]:pt-5">
		<h2 class="flex items-center gap-3 font-semibold text-[17px]"><span class="hub-tile w-9 h-9"><Icon icon="lucide:database" /></span> Данные</h2>
		<div class="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
			{@render row('Список ящиков', `${hub.mailboxes.length} — общий для всех устройств`)}
			<div class="flex gap-2">
				<button class="hub-btn" onclick={exportList} disabled={!hub.mailboxes.length}>
					<Icon icon="lucide:download" /> Экспорт
				</button>
				<button class="hub-btn hub-btn-danger" onclick={clearAll} disabled={!hub.mailboxes.length}>
					<Icon icon="lucide:trash-2" /> Очистить
				</button>
			</div>
		</div>
		<div class="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
			{@render row('Выйти на этом устройстве', 'Сайт снова спросит пароль, список ящиков на этом устройстве сотрётся (на сервере останется)')}
			<form method="POST" action="/logout" bind:this={logoutForm} onsubmit={logout}>
				<button class="hub-btn" type="submit" disabled={loggingOut}>
					<Icon icon="lucide:log-out" /> {loggingOut ? 'Выход…' : 'Выйти'}
				</button>
			</form>
		</div>
	</section>
</div>
