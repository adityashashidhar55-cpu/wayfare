/**
 * Static FX table (units of currency per 1 USD). Shared by client + server.
 *
 * r27: this is now the FALLBACK, not the only source. Live rates are fetched
 * daily into the `fx_rates` table by api/lib/fx-refresh.ts and passed into
 * convertCents() as the optional third argument. These numbers stay because
 * an app that cannot reach a rates API must still be able to add up a trip
 * budget - being slightly stale beats showing nothing.
 */
export const FX_PER_USD: Record<string, number> = {
  USD: 1,
  EUR: 0.92,
  GBP: 0.79,
  JPY: 152,
  KRW: 1380,
  THB: 36.5,
  MXN: 18.2,
  MAD: 10.1,
  ISK: 139,
  DKK: 6.86,
  AUD: 1.52,
  CAD: 1.37,
  CNY: 7.24,
  INR: 83.5,
  BRL: 5.1,
  VND: 25400,
  IDR: 16200,
};

export const CURRENCY_SYMBOLS: Record<string, string> = {
  USD: "$",
  EUR: "€",
  GBP: "£",
  JPY: "¥",
  KRW: "₩",
  THB: "฿",
  MXN: "$",
  MAD: "DH",
  ISK: "kr",
  DKK: "kr",
  AUD: "$",
  CAD: "$",
  CNY: "¥",
  INR: "₹",
  BRL: "R$",
  VND: "₫",
  IDR: "Rp",
  // Local currencies used by explore_places price data (seed-prices)
  AED: "AED ",
  CZK: "Kč",
  HUF: "Ft",
  PLN: "zł",
  TRY: "₺",
  EGP: "E£",
  JOD: "JD",
  ILS: "₪",
  NPR: "Rs",
  LAK: "₭",
  HKD: "HK$",
  TWD: "NT$",
  SGD: "S$",
  MYR: "RM",
  PEN: "S/",
  ARS: "AR$",
  ZAR: "R",
  NZD: "NZ$",
};

/** Currencies whose minor unit is not used in practice (whole-unit display). */
const ZERO_DECIMAL = new Set([
  "JPY", "KRW", "VND", "IDR", "ISK",
  "HUF", "CZK", "TRY", "EGP", "LAK", "ARS",
  // r25: INR and NPR removed. The rupee's minor unit is very much used in
  // practice — real Indian receipts carry paise, and this is an India-first
  // product. Amounts were stored precisely (₹150.50 -> 15050) and then always
  // DISPLAYED rounded to ₹151, so the ledger and the receipt disagreed.
]);

/**
 * Convert amountCents between currencies.
 *
 * `rates` is optional and defaults to the static table, so every existing
 * caller keeps working unchanged. Server code that touches money a user will
 * see - persisting an expense's homeCents above all - should pass the live
 * rates from api/lib/fx-refresh.ts instead.
 *
 * A currency missing from the table falls back to a rate of 1 rather than
 * throwing: a wrong-but-visible number the user can correct beats a crash in
 * the middle of adding an expense.
 */
export function convertCents(
  amountCents: number,
  from: string,
  to: string,
  rates: Record<string, number> = FX_PER_USD,
): number {
  if (from === to) return amountCents;
  const fromRate = rates[from] ?? FX_PER_USD[from] ?? 1;
  const toRate = rates[to] ?? FX_PER_USD[to] ?? 1;
  return Math.round((amountCents / fromRate) * toRate);
}

export function formatMoney(cents: number, currency: string): string {
  const sym = CURRENCY_SYMBOLS[currency] ?? currency + " ";
  const zeroDecimal = ZERO_DECIMAL.has(currency);
  const value = zeroDecimal ? Math.round(cents / 100) : cents / 100;
  const str = zeroDecimal
    ? Math.round(value).toLocaleString()
    : value.toLocaleString(undefined, {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      });
  return `${sym}${str}`;
}

/** formatMoney without a trailing ".00" - for compact chips/badges ("€18" not "€18.00"). */
export function formatMoneyCompact(cents: number, currency: string): string {
  return formatMoney(cents, currency).replace(/\.00$/, "");
}
