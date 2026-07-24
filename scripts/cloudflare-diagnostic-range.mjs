import ts from 'typescript';
import { mkdirSync, writeFileSync } from 'node:fs';

const configFile = ts.readConfigFile('tsconfig.json', ts.sys.readFile);
if (configFile.error) {
  console.error(ts.formatDiagnosticsWithColorAndContext([configFile.error], {
    getCanonicalFileName: (name) => name,
    getCurrentDirectory: ts.sys.getCurrentDirectory,
    getNewLine: () => ts.sys.newLine,
  }));
  process.exit(1);
}

const parsed = ts.parseJsonConfigFileContent(
  configFile.config,
  ts.sys,
  ts.sys.getCurrentDirectory(),
  undefined,
  'tsconfig.json',
);
const program = ts.createProgram(parsed.fileNames, parsed.options);
const diagnostics = ts.getPreEmitDiagnostics(program);
const formatted = diagnostics.map((diagnostic) => {
  const fileName = diagnostic.file?.fileName.replaceAll('\\', '/') ?? null;
  const location = diagnostic.file && diagnostic.start !== undefined
    ? diagnostic.file.getLineAndCharacterOfPosition(diagnostic.start)
    : null;
  return {
    code: diagnostic.code,
    fileName,
    line: location ? location.line + 1 : null,
    column: location ? location.character + 1 : null,
    message: ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n'),
  };
});

mkdirSync('dist', { recursive: true });
writeFileSync('dist/typecheck-diagnostics.json', `${JSON.stringify(formatted, null, 2)}\n`);
writeFileSync(
  'dist/index.html',
  '<!doctype html><meta charset="utf-8"><title>TypeScript diagnostics</title><a href="/typecheck-diagnostics.json">typecheck-diagnostics.json</a>',
);
console.log(JSON.stringify({ diagnosticCount: formatted.length }));
