const RATE = 0.21;
/** Tax for an amount, in cents precision. */
export function computeTax(amount: number, rate: number = RATE): number {
  const raw = amount * rate;
  return Math.round(raw * 100) / 100;
}
