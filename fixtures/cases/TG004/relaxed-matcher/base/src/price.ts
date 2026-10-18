export interface Line { sku: string; qty: number; unit: number }
export const total = (lines: Line[]): number => lines.reduce((s, l) => s + l.qty * l.unit, 0);
export const parsePrice = (text: string): { amount: number; currency: string } => {
  const [amount, currency] = text.trim().split(/\s+/);
  return { amount: Number(amount), currency: currency ?? "EUR" };
};
export const notify = (send: (msg: string) => void, amount: number): void => send(`total ${amount}`);
