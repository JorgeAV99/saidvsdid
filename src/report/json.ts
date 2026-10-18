import type { Report } from './model.js';

export function renderJson(report: Report): string {
  return JSON.stringify(report, null, 2) + '\n';
}
