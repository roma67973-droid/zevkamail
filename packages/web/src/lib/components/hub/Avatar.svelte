<script lang="ts">
	/**
	 * Цветной кружок/плитка с первой буквой. Цвет стабилен для одной и той же строки (seed),
	 * поэтому у ящика и отправителя он всегда одинаковый.
	 */
	interface Props {
		name: string;
		seed?: string;
		/** Размер в пикселях */
		size?: number;
		/** Скруглённый квадрат вместо круга */
		square?: boolean;
		class?: string;
	}
	let { name, seed, size = 36, square = false, class: cls = '' }: Props = $props();

	// Пары «светлее → темнее» для мягкого градиента.
	const PALETTE: [string, string][] = [
		['#3b82f6', '#1d4ed8'],
		['#8b5cf6', '#6d28d9'],
		['#06b6d4', '#0e7490'],
		['#ec4899', '#be185d'],
		['#10b981', '#047857'],
		['#f97316', '#c2410c'],
		['#6366f1', '#4338ca'],
		['#14b8a6', '#0f766e']
	];

	let pair = $derived.by(() => {
		let h = 0;
		for (const ch of seed ?? name) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
		return PALETTE[h % PALETTE.length];
	});

	let letter = $derived(((name.match(/[\p{L}\p{N}]/u) ?? ['?'])[0] ?? '?').toUpperCase());
</script>

<span
	aria-hidden="true"
	class="relative inline-grid place-items-center shrink-0 font-bold text-white select-none {square ? 'rounded-[30%]' : 'rounded-full'} {cls}"
	style="width:{size}px;height:{size}px;font-size:{Math.round(size * 0.42)}px;background:linear-gradient(135deg,{pair[0]},{pair[1]});box-shadow:inset 0 1px 0 rgb(255 255 255 / .22),0 4px 12px -6px {pair[1]}"
>
	{letter}
</span>
