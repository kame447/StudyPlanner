import ts from 'typescript';
import { mkdirSync, writeFileSync } from 'node:fs';

const configFile = ts.readConfigFile('tsconfig.build.json', ts.sys.readFile);
if (configFile.error) {
  throw new Error(ts.flattenDiagnosticMessageText(configFile.error.messageText, '\n'));
}

const parsed = ts.parseJsonConfigFileContent(
  configFile.config,
  ts.sys,
  ts.sys.getCurrentDirectory(),
  undefined,
  'tsconfig.build.json',
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
const payload = JSON.stringify(formatted, null, 2)
  .replaceAll('&', '&amp;')
  .replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;');
writeFileSync(
  'dist/index.html',
  `<!doctype html><meta charset="utf-8"><title>TypeScript diagnostics</title><pre>${payload}</pre>`,
);
console.log(JSON.stringify({ diagnosticCount: formatted.length }));
