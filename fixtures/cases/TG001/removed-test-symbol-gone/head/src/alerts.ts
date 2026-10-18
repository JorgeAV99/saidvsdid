export function enabledEvents(list: string): string[] {
  return list === '' ? ['device', 'account'] : list.split(',');
}
