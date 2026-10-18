export function validateAmount(n: number): number {
  if (n < 0) throw new Error('negative amount');
  return n;
}
