export function calculateTax(amount: number): number {
  return Math.round(amount * 0.21 * 100) / 100;
}
