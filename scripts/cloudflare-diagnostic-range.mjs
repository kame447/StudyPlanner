import ts from 'typescript';
import { mkdirSync, writeFileSync } from 'node:fs';

const TARGETS = [
  'src/features/weeklyPlanning/weeklyPlanningTurnController.test.ts',
  'src/features/weeklyPlanning/trace/weeklyPlanningStableV5TraceSessionStorage.test.ts',
  'src/features/weeklyPlanning/trace/weeklyPlanningStableV5TraceRuntime.test.ts',
  'src/features/weeklyPlanning/trace/weeklyPlanningTraceRemoteRepository.test.ts',
  'src/features/weeklyPlanning/trace/weeklyPlanningStableV5TraceRemoteContinuity.integration.test.ts',
  'src/features/weeklyPlanning/__tests__/weeklyPlanningStableV5ConversationTrace.integration.test.ts',
];

const configFile = ts.readConfigFile('tsconfig.json', ts.sys.readFile);
if (configFile.error) process.exit(1);
const parsed = ts.parseJsonConfigFileContent(
  configFile.config,
  ts.sys,
  ts.sys.getCurrentDirectory(),
  undefined,
  'tsconfig.json',
);
const program = ts.createProgram(parsed.fileNames, parsed.options);
const diagnostics = ts.getPreEmitDiagnostics(program).map((diagnostic) => {
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
const targetDiagnostics = diagnostics.filter((diagnostic) =>
  diagnostic.fileName && TARGETS.some((target) => diagnostic.fileName.endsWith(target)));
const otherDiagnostics = diagnostics.filter((diagnostic) =>
  !diagnostic.fileName || !TARGETS.some((target) => diagnostic.fileName.endsWith(target)));

mkdirSync('dist', { recursive: true });
writeFileSync('dist/typecheck-diagnostics.json', `${JSON.stringify(diagnostics, null, 2)}\n`);
writeFileSync('dist/index.html', '<!doctype html><meta charset="utf-8"><title>TypeScript diagnostic isolation</title>');
console.log(JSON.stringify({
  diagnosticCount: diagnostics.length,
  targetCount: targetDiagnostics.length,
  otherCount: otherDiagnostics.length,
}));
process.exit(targetDiagnostics.length > 0 && otherDiagnostics.length === 0 ? 0 : 1);
