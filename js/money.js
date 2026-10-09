// Store decimal currency units; calculate using integral cents.
export const MAX_MONEY = 99999999999.99;
export function validMoney(value, { positive = false, signed = false } = {}) {
  if (value === null || value === undefined || String(value).trim() === '') return false;
  const n = Number(value);
  return Number.isFinite(n) && Math.abs(n) <= MAX_MONEY && (signed || n >= 0) && (!positive || n > 0) && Math.abs(n * 100 - Math.round(n * 100)) < 0.001;
}
export const cents = value => Math.round(Number(value || 0) * 100);
export const money = value => cents(value) / 100;
export function sumMoney(values) { return values.reduce((sum, value) => sum + cents(value), 0) / 100; }
