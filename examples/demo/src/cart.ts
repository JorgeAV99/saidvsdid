export interface Line {
  price: number;
  qty: number;
}

export function total(lines: Line[], discount = 0): number {
  if (discount < 0 || discount > 1) throw new RangeError('discount must be between 0 and 1');
  const gross = lines.reduce((sum, l) => sum + l.price * l.qty, 0);
  return Math.round(gross * (1 - discount) * 100) / 100;
}
