import path from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { reporterState, strictReporter } from './mutation-partition-reporter.mjs';

if (!process.env.MUTATION_TOOLS_DIRECTORY) throw new Error('Missing isolated mutation tool binding');
const requireTool = createRequire(path.join(process.env.MUTATION_TOOLS_DIRECTORY, 'package.json'));
const { declareFactoryPlugin, PluginKind, tokens, commonTokens } = await import(pathToFileURL(requireTool.resolve('@stryker-mutator/api/plugin')).href);
const coreRoot = path.dirname(requireTool.resolve('@stryker-mutator/core/package.json'));
// The pinned core token is an explicit dependency, not a patched prototype.
const { coreTokens } = await import(pathToFileURL(path.join(coreRoot, 'dist/src/di/index.js')).href);
function factory(creator, options) {
  const names = ['clear-text', process.stdout.isTTY ? 'progress' : 'progress-append-only', 'json', 'event-recorder'];
  return strictReporter(Object.fromEntries(names.map(name => [name, creator.create(PluginKind.Reporter, name)])), reporterState, options.thresholds.break);
}
factory.inject = tokens(coreTokens.pluginCreator, commonTokens.options);
export const strykerPlugins = [declareFactoryPlugin(PluginKind.Reporter, 'strict-mutation-evidence', factory)];
