/**
 * Finding a registration / confirmation code in an email.
 * Pure function, no Svelte state - unit-tested in __tests__/code.test.ts.
 */

const KEYWORD =
	/(?<!\p{L})(?:code|kod|код|pin|otp|passcode|verification|verify|подтвержд\p{L}*|пароль|одноразов\p{L}*)(?!\p{L})[^\n]{0,30}?(?<![\p{L}\d.,#№-])(\d{4,8})(?![\p{L}\d]|[.,-]\d)/iu;
const YEAR = /^(19|20)\d\d$/;

/** Returns the code (4-8 digits) or null if unsure. */
export function findCode(subject: string, text: string): string | null {
	for (const hay of [subject, text]) {
		const m = hay.match(KEYWORD);
		if (m && !YEAR.test(m[1])) return m[1];
	}
	// Fallback: exactly 6 standalone digits in the subject ("123456 is your code").
	const six = subject.match(/(?<![\d.,#№])\b(\d{6})\b(?![\d.,]\d)/);
	return six ? six[1] : null;
}
