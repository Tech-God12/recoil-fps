import { readFile, access } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

export async function resolve(specifier, context, nextResolve) {
  if (specifier.startsWith('.') && context.parentURL?.startsWith('file:')) {
    const base = new URL(specifier, context.parentURL);
    if (!/\.[a-z]+$/i.test(base.pathname)) {
      for (const extension of ['.ts', '.tsx', '.js', '.json']) {
        const url = new URL(base.href + extension);
        try {
          await access(url);
          return { url: url.href, shortCircuit: true };
        } catch { /* Try the next supported source extension. */ }
      }
    }
  }
  return nextResolve(specifier, context);
}

export async function load(url, context, nextLoad) {
  if (url.startsWith('file:') && /\.(ts|tsx)$/.test(url)) {
    const source = await readFile(new URL(url), 'utf8');
    const result = ts.transpileModule(source, {
      fileName: fileURLToPath(url),
      compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, jsx: ts.JsxEmit.ReactJSX },
      reportDiagnostics: true,
    });
    const errors = result.diagnostics?.filter(d => d.category === ts.DiagnosticCategory.Error) ?? [];
    if (errors.length) throw new Error(ts.formatDiagnosticsWithColorAndContext(errors, {
      getCurrentDirectory: () => process.cwd(), getCanonicalFileName: f => f, getNewLine: () => '\n',
    }));
    return { format: 'module', source: result.outputText, shortCircuit: true };
  }
  if (url.startsWith('file:') && url.endsWith('.json') && !url.includes('/node_modules/')) {
    const value = JSON.parse(await readFile(new URL(url), 'utf8'));
    return { format: 'module', source: `export default ${JSON.stringify(value)};`, shortCircuit: true };
  }
  return nextLoad(url, context);
}