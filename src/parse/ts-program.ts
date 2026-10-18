// The TypeScript compiler's reading of one JavaScript/TypeScript file (ts-binding.ts asks it which
// symbol each name is). A program of that file alone, with a host that serves nothing else: no lib,
// no types, no module resolution, JavaScript allowed. Programs are cached by content, compiler
// version, options and file kind for the life of the process.
import { createHash } from 'node:crypto';
import ts from 'typescript';

export interface TsProgram {
  file: ts.SourceFile;
  checker: ts.TypeChecker;
  /** Why the compiler's reading is not used (it rejects the file's syntax or declarations), or null. */
  issue: string | null;
}

export const TS_OPTIONS: Readonly<ts.CompilerOptions> = {
  noLib: true,
  types: [],
  noResolve: true,
  allowJs: true,
  checkJs: false,
  jsx: ts.JsxEmit.Preserve,
  target: ts.ScriptTarget.ESNext,
  module: ts.ModuleKind.ESNext,
  noEmit: true,
};
const OPTIONS_KEY = JSON.stringify(TS_OPTIONS);

const cache = new Map<string, TsProgram>();
const CACHE_LIMIT = 256;

/** The extension the compiler reads the file by (`.ts`, `.tsx`, `.js`, `.mjs`…). */
function extension(path: string): string {
  const m = /\.[cm]?[jt]sx?$/i.exec(path);
  return m ? m[0].toLowerCase() : '.ts';
}

function message(d: ts.Diagnostic): string {
  const text = ts.flattenDiagnosticMessageText(d.messageText, ' ');
  if (!d.file || d.start === undefined) return text;
  return `${text} (line ${d.file.getLineAndCharacterOfPosition(d.start).line + 1})`;
}

export function tsProgram(source: string, path: string): TsProgram {
  const name = `/saidvsdid${extension(path)}`;
  const key = createHash('sha256').update(`${ts.version}\0${OPTIONS_KEY}\0${name}\0`).update(source).digest('hex');
  const hit = cache.get(key);
  if (hit) return hit;
  const file = ts.createSourceFile(name, source, ts.ScriptTarget.ESNext, true);
  const host: ts.CompilerHost = {
    getSourceFile: (f) => (f === name ? file : undefined),
    getDefaultLibFileName: () => '/lib.d.ts',
    writeFile: () => undefined,
    getCurrentDirectory: () => '/',
    getDirectories: () => [],
    fileExists: (f) => f === name,
    readFile: (f) => (f === name ? source : undefined),
    getCanonicalFileName: (f) => f,
    useCaseSensitiveFileNames: () => true,
    getNewLine: () => '\n',
  };
  const program = ts.createProgram({ rootNames: [name], options: TS_OPTIONS, host });
  const checker = program.getTypeChecker();
  // The binder's errors (a duplicate declaration, `arguments` in strict code…) are on the file once
  // the checker has bound it; the compiler keeps them there, not in the public API.
  const bind = (file as ts.SourceFile & { bindDiagnostics?: readonly ts.Diagnostic[] }).bindDiagnostics;
  const syntax = program.getSyntacticDiagnostics(file);
  let issue: string | null = null;
  if (syntax.length > 0) issue = `TypeScript ${ts.version} rejects the file's syntax: ${message(syntax[0]!)}`;
  else if (bind === undefined) issue = `TypeScript ${ts.version} does not expose its binder's diagnostics`;
  else if (bind.some((d) => d.category === ts.DiagnosticCategory.Error)) issue = `TypeScript ${ts.version} rejects the file's declarations: ${message(bind.find((d) => d.category === ts.DiagnosticCategory.Error)!)}`;
  const result = { file, checker, issue };
  if (cache.size >= CACHE_LIMIT) cache.clear();
  cache.set(key, result);
  return result;
}
