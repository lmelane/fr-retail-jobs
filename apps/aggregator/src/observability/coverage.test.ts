import { readFileSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { expect, it } from 'vitest';

// Walk the actual scheduled business dependency graph, including adapters and
// dynamic imports. Manual discovery/remediation commands are a separate surface.
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
it('prevents raw console output and unawaited diagnostics in scheduled worker dependencies', () => {
  const seen = new Set<string>();
  const violations: string[] = [];
  function visit(file: string, traverse = true) {
    if (seen.has(file) || !existsSync(file)) return;
    seen.add(file);
    const source = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true);
    function walk(node: ts.Node) {
      if (ts.isCallExpression(node)) {
        const call = node.expression.getText(source);
        if (/^(console\.(log|info|debug|warn|error)|process\.(stdout|stderr)\.write)$/.test(call)) {
          if (!file.endsWith('/observability/logger.ts')) violations.push(`${file}: raw ${call}`);
        }
        if (/^log\.(debug|info|warn|error)$/.test(call) && !ts.isAwaitExpression(node.parent) && !ts.isReturnStatement(node.parent) && !ts.isArrowFunction(node.parent)) violations.push(`${file}: unawaited ${call}`);
      }
      const imported = ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier) ? node.moduleSpecifier.text
        : ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword && node.arguments[0] && ts.isStringLiteral(node.arguments[0]) ? node.arguments[0].text : undefined;
      if (traverse && imported?.startsWith('.')) visit(resolve(dirname(file), imported.replace(/\.js$/, '.ts')));
      ts.forEachChild(node, walk);
    }
    walk(source);
  }
  for (const file of ['pipeline/ingestOrchestrator.ts','pipeline/refresh.ts','pipeline/reconcile.ts','pipeline/geocodeJobs.ts','pipeline/snapshot.ts','pipeline/classifyJobs.ts','pipeline/healthReport.ts','pipeline/alert.ts','pipeline/googleIndexing.ts','pipeline/heartbeat.ts','pipeline/egressProbe.ts']) visit(resolve(root, file));
  visit(resolve(root, 'cli.ts'), false);
  expect(seen.size).toBeGreaterThan(70);
  expect(violations).toEqual([]);
});
