// src/lib/format.ts

// src/lib/format.ts
const nf1 = new Intl.NumberFormat(undefined, {
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
});
const nf0 = new Intl.NumberFormat(undefined, {
  maximumFractionDigits: 0,
});

export function f1(n?: number | null): string {
  return n == null || Number.isNaN(n) ? "–" : nf1.format(n);
}

export function f0(n?: number | null): string {
  return n == null || Number.isNaN(n) ? "–" : nf0.format(n);
}
