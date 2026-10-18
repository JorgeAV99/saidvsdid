export const add = (a: number, b: number): number => a + b;
export const div = (a: number, b: number): number => {
  if (b === 0) throw new RangeError('division by zero');
  return a / b;
};
