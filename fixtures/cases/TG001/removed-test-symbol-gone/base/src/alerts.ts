export function wanted(list: string): string[] {
  return list === '-' ? [] : list.split(',');
}

export function enabledEvents(list: string): string[] {
  return list === '' ? ['device', 'account'] : list.split(',');
}
