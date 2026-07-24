import ts from 'typescript';
import { mkdirSync, writeFileSync } from 'node:fs';

const TARGET = 'src/features/weeklyPlanning/weeklyPlanningTurnController.ts';
const LINE_UPPER_BOUND = 300;
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
writeFileSync('dist/index.html', '<!doctype html><meta charset="utf-8"><title>diagnostic predicate</title>');
const diagnostic = formatted.length === 1 ? formatted[0] : undefined;
const matches = diagnostic?.fileName?.endsWith(TARGET) === true
  && diagnostic.line !== null
  && diagnostic.line <= LINE_UPPER_BOUND;
process.exit(matches ? 0 : 1);
