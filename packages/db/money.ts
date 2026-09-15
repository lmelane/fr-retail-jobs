import { Prisma } from '@prisma/client';

export type AmountInput = number | string | Prisma.Decimal;

/** PostgreSQL must never silently round an amount to the column's scale. */
export function storedAmount(value: AmountInput | null | undefined): Prisma.Decimal | null {
  if (value == null) return null;
  const amount = new Prisma.Decimal(value);
  if (!amount.isFinite() || amount.isNegative() || amount.decimalPlaces() > 6 || amount.abs().gte('1000000000000000000')) {
    throw new Error('Salary amount cannot be stored without loss');
  }
  return amount;
}

/** Preserve the existing numeric API contract only when decimal round-trip is exact. */
export function publicAmount(value: AmountInput | null): number | null {
  if (value === null) return null;
  const amount = new Prisma.Decimal(value);
  const number = amount.toNumber();
  return Number.isFinite(number) && Math.abs(number) <= Number.MAX_SAFE_INTEGER && amount.equals(new Prisma.Decimal(number)) ? number : null;
}

export function sameAmount(a: AmountInput | null, b: AmountInput | null): boolean {
  return a === null || b === null ? a === b : new Prisma.Decimal(a).equals(new Prisma.Decimal(b));
}
