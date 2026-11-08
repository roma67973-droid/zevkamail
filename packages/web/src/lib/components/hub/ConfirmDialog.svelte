<script lang="ts">
	import Icon from '@iconify/svelte';
	import { answer, dialog } from '$lib/stores/dialog.svelte';

	let okBtn: HTMLButtonElement | undefined = $state();

	// Focus the confirm button when the dialog opens.
	$effect(() => {
		if (dialog.current && okBtn) okBtn.focus();
	});

	function onKey(e: KeyboardEvent) {
		if (!dialog.current) return;
		if (e.key === 'Escape') {
			e.preventDefault();
			answer(false);
		}
	}
</script>

<svelte:window onkeydown={onKey} />

{#if dialog.current}
	{@const d = dialog.current}
	<div
		class="fixed inset-0 z-[100] flex items-end sm:items-center justify-center p-3 sm:p-4 pb-[max(0.75rem,env(safe-area-inset-bottom))]"
	>
		<button
			class="absolute inset-0 bg-[#030712]/70 backdrop-blur-sm hub-fade"
			aria-label="Отмена"
			tabindex="-1"
			onclick={() => answer(false)}
		></button>
		<div
			role="alertdialog"
			aria-modal="true"
			aria-labelledby="hub-dialog-title"
			class="relative w-full max-w-md hub-card bg-[#111d35] p-5 sm:p-6 rounded-3xl sm:rounded-[20px] shadow-[0_30px_80px_-20px_rgb(0_0_0/0.9)] hub-pop"
		>
			<div class="flex gap-4">
				<div
					class="shrink-0 w-12 h-12 rounded-2xl grid place-items-center text-xl ring-1 ring-inset
						{d.danger ? 'bg-red-500/15 text-red-400 ring-red-500/25' : 'bg-[var(--hub-accent)]/15 hub-accent-text ring-[color:var(--hub-accent)]/25'}"
				>
					<Icon icon={d.icon ?? (d.danger ? 'lucide:trash-2' : 'lucide:circle-help')} />
				</div>
				<div class="min-w-0 pt-1">
					<h2 id="hub-dialog-title" class="font-semibold text-[17px] leading-snug break-words">{d.title}</h2>
					{#if d.text}
						<p class="text-sm text-[var(--hub-muted)] mt-1.5 leading-relaxed">{d.text}</p>
					{/if}
				</div>
			</div>
			<div class="flex flex-col-reverse sm:flex-row sm:justify-end gap-2 mt-6">
				<button class="hub-btn justify-center min-h-11 sm:min-h-10 sm:px-4" onclick={() => answer(false)}>
					{d.cancel ?? 'Отмена'}
				</button>
				<button
					bind:this={okBtn}
					class="hub-btn justify-center min-h-11 sm:min-h-10 sm:px-4 {d.danger ? 'hub-btn-danger-solid' : 'hub-btn-primary'}"
					onclick={() => answer(true)}
				>
					{d.ok ?? 'OK'}
				</button>
			</div>
		</div>
	</div>
{/if}

<style>
	.hub-fade {
		animation: hub-fade 0.15s ease-out;
	}
	@keyframes hub-fade {
		from {
			opacity: 0;
		}
	}
</style>
