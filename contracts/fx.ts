// Static FX table (units of currency per 1 USD). Shared by client + server.
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
  "HUF", "CZK", "TRY", "EGP", "NPR", "LAK", "ARS", "INR",
]);

/** Convert amountCents from `from` currency to `to` currency using static rates. */
export function convertCents(
  amountCents: number,
  from: string,
  to: string,
): number {
  if (from === to) return amountCents;
  const fromRate = FX_PER_USD[from] ?? 1;
  const toRate = FX_PER_USD[to] ?? 1;
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
