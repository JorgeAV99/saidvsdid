export interface Line { amount: number; qty: number }
export function total(items: number[]): number {
  let sum = 0;
  for (const item of items) sum += item;
  return sum;
}
