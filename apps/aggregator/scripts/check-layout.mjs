import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const app = fileURLToPath(new URL('../', import.meta.url));
const errors = [];
const repo = fileURLToPath(new URL('../../../', import.meta.url));
const repositoryEntries = new Set(['.git', '.github', '.gitignore', '.gitattributes', '.dockerignore',
  '.claude', '.codex', '.vscode', '.idea', '.editorconfig', '.openai', '.env', '.env.example',
  'README.md', 'CLAUDE.md', 'AGENTS.md', 'LICENSE', 'LICENSE.md', 'NOTICE',
  'package.json', 'package-lock.json', 'apps', 'packages', 'docs', 'audits', 'backups', 'node_modules']);
for (const entry of readdirSync(repo)) {
  if (!repositoryEntries.has(entry) && !entry.startsWith('.env.'))
    errors.push(`Unclassified repository root entry: ${entry}; put reports in audits/, private outputs in backups/, or explicitly review new infrastructure files`);
}
const walk = (directory) => readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
  const path = join(directory, entry.name);
  return entry.isDirectory() ? walk(path) : [path];
});
const rootEntries = new Set(['README.md', 'Dockerfile', 'package.json', 'package-lock.json', 'start.sh',
  'tsconfig.json', 'tsconfig.scripts.json', 'vitest.config.ts', 'src', 'scripts', 'data',
  'node_modules', 'dist', 'coverage', '.env', '.env.example']);
for (const entry of readdirSync(app)) if (!rootEntries.has(entry)) errors.push(`Unexpected application root entry: ${entry}`);
for (const entry of readdirSync(join(app, 'data'))) {
  if (!['README.md', 'reference', 'imports', 'seeds'].includes(entry)) errors.push(`Unclassified data: ${entry}`);
}
for (const path of walk(join(app, 'src'))) {
  const name = relative(app, path);
  if (/\.(mts|mjs|py)$/.test(path)) errors.push(`Operational script belongs in scripts/: ${name}`);
  if (/\.(ts|json)$/.test(path) && /(?:\.\.\/)+(?:audits|backups)\//.test(readFileSync(path, 'utf8')))
    errors.push(`Runtime depends on an archive: ${name}`);
}
for (const path of walk(join(app, 'scripts'))) {
  if (path.endsWith('.pyc') || path.endsWith('.DS_Store')) errors.push(`Generated file in scripts/: ${relative(app,path)}`);
}
for (const entry of ['reference/maisons.csv', 'reference/country-labels.json', 'reference/UNICODE-LICENSE.txt',
  'reference/villes-exonymes.csv', 'reference/villes-non-lieux.csv', 'reference/discovery-career-signals.json', 'seeds/sources.csv']) {
  try { if (!statSync(join(app, 'data', entry)).isFile()) throw Error(); }
  catch { errors.push(`Required reference missing: ${entry}`); }
}
if (errors.length) { console.error(errors.join('\n')); process.exitCode = 1; }
else console.log('Application layout valid: runtime, tools, references and archives are separated.');
