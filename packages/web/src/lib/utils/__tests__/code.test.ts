import { describe, expect, it } from 'vitest';
import { findCode } from '../code';

describe('findCode', () => {
	it('finds a code after a keyword (EN / RU)', () => {
		expect(findCode('Steam Guard', 'Your verification code: 48291')).toBe('48291');
		expect(findCode('Вход в аккаунт', 'Код подтверждения: 739104')).toBe('739104');
		expect(findCode('Discord', 'Ваш одноразовый пароль 5521')).toBe('5521');
	});

	it('prefers the subject over the body', () => {
		expect(findCode('Код 111222', 'code 999888')).toBe('111222');
	});

	it('uses 6 standalone digits in the subject as a fallback', () => {
		expect(findCode('123456 is your login', 'Welcome!')).toBe('123456');
	});

	it('ignores years, prices, order numbers and phone-like numbers', () => {
		expect(findCode('Newsletter', 'Promo code valid until 2026')).toBeNull();
		expect(findCode('Order #123456', 'Thanks for your order')).toBeNull();
		expect(findCode('Sale', 'Code word: price 1299.99')).toBeNull();
		expect(findCode('Hello', 'Call us: 8-800-555-35-35')).toBeNull();
	});

	it('does not match inside words or longer numbers', () => {
		expect(findCode('Barcode', 'barcode 123456789012')).toBeNull();
		expect(findCode('Info', 'No digits here, just a decoded message')).toBeNull();
	});
});
