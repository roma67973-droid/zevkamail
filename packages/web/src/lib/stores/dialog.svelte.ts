/**
 * In-app confirmation dialog (replaces the browser's grey confirm()).
 * Usage: `if (!(await ask({ title: 'Удалить?', ok: 'Удалить', danger: true }))) return;`
 */

export interface AskOptions {
	title: string;
	text?: string;
	/** Text of the confirm button (default "OK"). */
	ok?: string;
	cancel?: string;
	/** Red confirm button for destructive actions. */
	danger?: boolean;
	/** Iconify name, e.g. 'lucide:trash-2'. */
	icon?: string;
}

interface Pending extends AskOptions {
	resolve: (v: boolean) => void;
}

class DialogState {
	current = $state<Pending | null>(null);
}

export const dialog = new DialogState();

export function ask(opts: AskOptions): Promise<boolean> {
	return new Promise((resolve) => {
		dialog.current?.resolve(false); // a new question cancels the old one
		dialog.current = { ...opts, resolve };
	});
}

export function answer(v: boolean) {
	const c = dialog.current;
	dialog.current = null;
	c?.resolve(v);
}
