import ts from 'typescript';
import { mkdirSync, writeFileSync } from 'node:fs';

const TARGET = 'src/features/weeklyPlanning/weeklyPlanningTurnController.ts';
const THRESHOLD = 160;

const configFile = ts.readConfigFile('tsconfig.build.json', ts.sys.readFile);
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
  'tsconfig.build.json',
);
const program = ts.createProgram(parsed.fileNames, parsed.options);
const diagnostics = ts.getPreEmitDiagnostics(program);
const formatted = diagnostics.map((diagnostic) => {
  const fileName = diagnostic.file?.fileName.replaceAll('\\', '/') ?? null;
  const line = diagnostic.file && diagnostic.start !== undefined
    ? diagnostic.file.getLineAndCharacterOfPosition(diagnostic.start).line + 1
    : null;
  return {
    code: diagnostic.code,
    fileName,
    line,
    message: ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n'),
  };
});
console.log(JSON.stringify(formatted, null, 2));

mkdirSync('dist', { recursive: true });
writeFileSync('dist/index.html', '<!doctype html><meta charset="utf-8"><title>diagnostic range</title>');

const targetDiagnostics = formatted.filter((item) => item.fileName?.endsWith(TARGET));
const otherDiagnostics = formatted.filter((item) => !item.fileName?.endsWith(TARGET));
const allAfterThreshold = targetDiagnostics.length > 0
  && targetDiagnostics.every((item) => item.line !== null && item.line > THRESHOLD);
process.exit(otherDiagnostics.length === 0 && allAfterThreshold ? 0 : 1);
