// Entry point of the GitHub Action (action.yml runs `node dist/action/main.js`).
import { commandData, parseFailOn, runAction } from './run.js';

try {
  const result = await runAction({ env: process.env, fetch, log: (line) => process.stdout.write(`${line}\n`) });
  process.exitCode = result.exitCode;
} catch (e) {
  // A defect of the Action itself: reported, and blocking only when the workflow asked to block on an ERROR.
  process.stdout.write(`::error::saidvsdid: ${commandData(e instanceof Error ? (e.stack ?? e.message) : String(e))}\n`);
  let failOn: string = 'fail';
  try {
    failOn = parseFailOn(process.env['INPUT_FAIL_ON']);
  } catch {
    failOn = 'fail';
  }
  process.exitCode = failOn === 'none' ? 0 : 1;
}
