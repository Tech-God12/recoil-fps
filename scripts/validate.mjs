import { spawnSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { ESLint } from 'eslint';
import ts from 'typescript';

const root = fileURLToPath(new URL('../', import.meta.url));
process.chdir(root);
const eslint = new ESLint();
const lint = await eslint.lintFiles(['src/**/*.{ts,tsx}', 'tests/**/*.js', 'scripts/*.mjs']);
const formatter = await eslint.loadFormatter('stylish');
const formatted = formatter.format(lint);
if (formatted) console.log(formatted);
if (lint.some(result => result.errorCount || result.warningCount)) process.exit(1);
console.log('Lint passed.');

const configFile = ts.readConfigFile('tsconfig.json', ts.sys.readFile);
if (configFile.error) throw new Error(ts.flattenDiagnosticMessageText(configFile.error.messageText, '\n'));
const config = ts.parseJsonConfigFileContent(configFile.config, ts.sys, root);
const program = ts.createProgram(config.fileNames, config.options);
const diagnostics = [...config.errors, ...ts.getPreEmitDiagnostics(program)];
if (diagnostics.length) {
  console.error(ts.formatDiagnosticsWithColorAndContext(diagnostics, {
    getCanonicalFileName: name => name, getCurrentDirectory: () => root, getNewLine: () => '\n',
  }));
  process.exit(1);
}
console.log('Typecheck passed.');

const tests = readdirSync('tests').filter(file => file.endsWith('.test.js')).map(file => `tests/${file}`);
const result = spawnSync(process.execPath, ['--test', '--test-concurrency=1', ...tests], { cwd: root, stdio: 'inherit' });
if (result.error) throw result.error;
if (result.status !== 0) process.exit(result.status ?? 1);
const mutations = spawnSync(process.execPath, ['scripts/mutate.mjs'], { cwd: root, stdio: 'inherit' });
if (mutations.error) throw mutations.error;
if (mutations.status !== 0) process.exit(mutations.status ?? 1);
console.log('Validation passed: lint, typecheck, Node tests, and mutation checks. No browser was used.');