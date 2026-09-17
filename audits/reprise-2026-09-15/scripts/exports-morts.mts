/**
 * EXPORTS ET MODULES SANS CONSOMMATEUR (lot 12) — analyse syntaxique par l'API
 * du compilateur TypeScript, sur les trois espaces de travail. Lecture seule.
 *
 * Pour chaque fichier : ses exports (déclarations, `export {}`, re-exports) et
 * ses imports (nommés, par défaut, espace de noms, effet de bord, dynamiques),
 * résolus avec les options du tsconfig de l'espace concerné. Un import
 * d'espace de noms, un effet de bord, un `import()` ou un `export *` marque
 * TOUS les exports du module cible comme consommés (prudence).
 *
 * Sortie : un JSON { exportsSansConsommateur, exportsConsommesParTemoinsSeuls,
 * modulesSansImporteur, specificateursNonResolus } et un résumé sur la sortie
 * standard. Le verdict par symbole reste humain : un script CLI, une route Next
 * ou un point d'entrée déclaré dans package.json n'ont pas d'importeur par
 * construction (racines), et un export « interne » peut simplement perdre son
 * `export`.
 *
 * Usage : npx tsx audits/reprise-2026-09-15/scripts/exports-morts.mts [sortie.json]
 */
import ts from 'typescript';
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const RACINE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const EXTENSIONS = new Set(['.ts', '.tsx', '.mts', '.mjs', '.js']);
// `scripts/coverage` est l'atelier de qualification des sources, pas un rapport de couverture : ne jamais l'exclure.
const IGNORER = new Set(['node_modules', '.next', 'dist', '__pycache__']);

type Zone = { nom: string; tsconfig: string; dossiers: string[] };
const ZONES: Zone[] = [
  { nom: 'aggregator', tsconfig: 'apps/aggregator/tsconfig.json', dossiers: ['apps/aggregator/src', 'apps/aggregator/scripts'] },
  { nom: 'api', tsconfig: 'apps/api/tsconfig.json', dossiers: ['apps/api/lib', 'apps/api/app', 'apps/api/scripts', 'apps/api/instrumentation.ts', 'apps/api/next.config.mjs', 'apps/api/vitest.config.ts'] },
  { nom: 'db', tsconfig: 'apps/aggregator/tsconfig.json', dossiers: ['packages/db'] },
];

function optionsDe(tsconfig: string): ts.CompilerOptions {
  const chemin = path.join(RACINE, tsconfig);
  const lu = ts.readConfigFile(chemin, ts.sys.readFile);
  if (lu.error) throw new Error(ts.flattenDiagnosticMessageText(lu.error.messageText, '\n'));
  return ts.parseJsonConfigFileContent(lu.config, ts.sys, path.dirname(chemin)).options;
}

function fichiersSous(entree: string): string[] {
  const absolu = path.join(RACINE, entree);
  if (!existsSync(absolu)) return [];
  if (statSync(absolu).isFile()) return [absolu];
  const sortie: string[] = [];
  for (const e of readdirSync(absolu, { withFileTypes: true })) {
    if (IGNORER.has(e.name)) continue;
    const p = path.join(absolu, e.name);
    if (e.isDirectory()) sortie.push(...fichiersSous(path.relative(RACINE, p)));
    else if (EXTENSIONS.has(path.extname(e.name)) && !e.name.endsWith('.d.ts')) sortie.push(p);
  }
  return sortie;
}

const zoneDe = new Map<string, Zone>();
const fichiers: string[] = [];
for (const zone of ZONES) for (const d of zone.dossiers) for (const f of fichiersSous(d)) { fichiers.push(f); zoneDe.set(f, zone); }
const options = new Map(ZONES.map((z) => [z.nom, optionsDe(z.tsconfig)] as const));
const reel = (p: string) => (ts.sys.realpath ? ts.sys.realpath(p) : p);
const ensemble = new Set(fichiers.map(reel));

type Export = { nom: string; ligne: number; fin: number; debut: number; genre: string; usageInterne: boolean };
const exportsPar = new Map<string, Export[]>();
const usages = new Map<string, Map<string, Set<string>>>(); // cible → nom (ou '*') → importeurs
const importeurs = new Map<string, Set<string>>();
const nonResolus: Array<{ fichier: string; specificateur: string }> = [];

function noter(cible: string, nom: string, depuis: string) {
  const parNom = usages.get(cible) ?? new Map<string, Set<string>>();
  usages.set(cible, parNom);
  (parNom.get(nom) ?? parNom.set(nom, new Set()).get(nom)!).add(depuis);
  (importeurs.get(cible) ?? importeurs.set(cible, new Set()).get(cible)!).add(depuis);
}

function resoudre(spec: string, depuis: string): string | null {
  if (!spec.startsWith('.') && !spec.startsWith('@catwalks/') && !spec.startsWith('@/')) return null; // dépendance externe
  const opts = options.get(zoneDe.get(depuis)!.nom)!;
  const r = ts.resolveModuleName(spec, depuis, opts, ts.sys).resolvedModule;
  if (!r) { nonResolus.push({ fichier: path.relative(RACINE, depuis), specificateur: spec }); return null; }
  const cible = reel(r.resolvedFileName);
  return ensemble.has(cible) ? cible : null; // hors périmètre (node_modules) : ignoré
}

const compteIdentifiants = (sf: ts.SourceFile) => {
  const c = new Map<string, number>();
  const visiter = (n: ts.Node) => { if (ts.isIdentifier(n)) c.set(n.text, (c.get(n.text) ?? 0) + 1); ts.forEachChild(n, visiter); };
  visiter(sf);
  return c;
};

for (const fichier of fichiers) {
  const texte = readFileSync(fichier, 'utf8');
  const sf = ts.createSourceFile(fichier, texte, ts.ScriptTarget.Latest, true, fichier.endsWith('.tsx') ? ts.ScriptKind.TSX : fichier.endsWith('.mjs') || fichier.endsWith('.js') ? ts.ScriptKind.JS : ts.ScriptKind.TS);
  const ids = compteIdentifiants(sf);
  const liste: Export[] = [];
  const ligne = (n: ts.Node) => sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1;
  // `debut` inclut les commentaires qui précèdent la déclaration (trivia), `fin` sa dernière ligne : de quoi la retirer entière.
  const ajouter = (nom: string, n: ts.Node, genre: string, portee: ts.Node = n) => liste.push({ nom, ligne: ligne(n), debut: sf.getLineAndCharacterOfPosition(portee.getFullStart()).line + 1, fin: sf.getLineAndCharacterOfPosition(portee.getEnd()).line + 1, genre, usageInterne: (ids.get(nom) ?? 0) > 1 });
  const estExporte = (n: ts.Node) => ts.canHaveModifiers(n) && (ts.getModifiers(n) ?? []).some((m) => m.kind === ts.SyntaxKind.ExportKeyword);
  const estDefaut = (n: ts.Node) => ts.canHaveModifiers(n) && (ts.getModifiers(n) ?? []).some((m) => m.kind === ts.SyntaxKind.DefaultKeyword);
  for (const st of sf.statements) {
    if (ts.isImportDeclaration(st) && ts.isStringLiteral(st.moduleSpecifier)) {
      const cible = resoudre(st.moduleSpecifier.text, fichier);
      if (!cible) continue;
      const c = st.importClause;
      if (!c) { noter(cible, '*', fichier); continue; }
      if (c.name) noter(cible, 'default', fichier);
      if (c.namedBindings) {
        if (ts.isNamespaceImport(c.namedBindings)) noter(cible, '*', fichier);
        else for (const e of c.namedBindings.elements) noter(cible, (e.propertyName ?? e.name).text, fichier);
      }
      continue;
    }
    if (ts.isExportDeclaration(st)) {
      const cible = st.moduleSpecifier && ts.isStringLiteral(st.moduleSpecifier) ? resoudre(st.moduleSpecifier.text, fichier) : null;
      if (st.exportClause && ts.isNamedExports(st.exportClause)) {
        for (const e of st.exportClause.elements) {
          ajouter(e.name.text, e, cible ? 're-export' : 'export-liste');
          if (cible) noter(cible, (e.propertyName ?? e.name).text, fichier);
        }
      } else if (cible) { noter(cible, '*', fichier); ajouter('*', st, 'export-etoile'); }
      continue;
    }
    if (ts.isExportAssignment(st)) { ajouter('default', st, 'export-default'); continue; }
    if (!estExporte(st)) continue;
    if (ts.isVariableStatement(st)) { for (const d of st.declarationList.declarations) if (ts.isIdentifier(d.name)) ajouter(d.name.text, d, 'const', st.declarationList.declarations.length === 1 ? st : d); }
    else if (ts.isFunctionDeclaration(st) || ts.isClassDeclaration(st) || ts.isInterfaceDeclaration(st) || ts.isTypeAliasDeclaration(st) || ts.isEnumDeclaration(st)) {
      ajouter(estDefaut(st) ? 'default' : st.name?.text ?? 'default', st, ts.SyntaxKind[st.kind].replace('Declaration', '').toLowerCase());
    }
  }
  exportsPar.set(fichier, liste);
  // Imports dynamiques : import('x') → tout le module est consommé.
  const dynamiques = (n: ts.Node) => {
    if (ts.isCallExpression(n) && n.expression.kind === ts.SyntaxKind.ImportKeyword && n.arguments[0] && ts.isStringLiteral(n.arguments[0])) {
      const cible = resoudre(n.arguments[0].text, fichier); if (cible) noter(cible, '*', fichier);
    }
    ts.forEachChild(n, dynamiques);
  };
  dynamiques(sf);
}

const estTemoin = (f: string) => /\.test\.(ts|tsx|mts)$/.test(f) || f.includes('/__tests__/') || f.includes('/src/test/');
const rel = (f: string) => path.relative(RACINE, f);
const sansConsommateur: Array<{ fichier: string; nom: string; ligne: number; debut: number; fin: number; genre: string; usageInterne: boolean }> = [];
const temoinsSeuls: Array<{ fichier: string; nom: string; ligne: number; debut: number; fin: number; genre: string; usageInterne: boolean; temoins: string[] }> = [];
for (const [fichier, liste] of exportsPar) {
  if (estTemoin(fichier)) continue;
  const parNom = usages.get(reel(fichier)) ?? new Map<string, Set<string>>();
  const tout = parNom.get('*') ?? new Set<string>();
  for (const e of liste) {
    if (e.nom === '*') continue;
    const consommateurs = new Set([...tout, ...(parNom.get(e.nom) ?? [])]);
    if (consommateurs.size === 0) sansConsommateur.push({ fichier: rel(fichier), nom: e.nom, ligne: e.ligne, debut: e.debut, fin: e.fin, genre: e.genre, usageInterne: e.usageInterne });
    else if ([...consommateurs].every(estTemoin)) temoinsSeuls.push({ fichier: rel(fichier), nom: e.nom, ligne: e.ligne, debut: e.debut, fin: e.fin, genre: e.genre, usageInterne: e.usageInterne, temoins: [...consommateurs].map(rel) });
  }
}
const racine = (f: string) => estTemoin(f) || /\/app\/.*(route|layout|page)\.tsx?$/.test(f) || /\/(cli|instrumentation)\.ts$/.test(f) || /\/scripts\//.test(f) || /\.config\.(ts|mjs)$/.test(f) || /packages\/db\/(index|prisma)/.test(f);
const modulesSansImporteur = fichiers.filter((f) => !racine(f) && !(importeurs.get(reel(f))?.size)).map(rel).sort();

const sortie = { date: new Date().toISOString(), fichiersAnalyses: fichiers.length, exportsSansConsommateur: sansConsommateur.sort((a, b) => a.fichier.localeCompare(b.fichier) || a.ligne - b.ligne), exportsConsommesParTemoinsSeuls: temoinsSeuls.sort((a, b) => a.fichier.localeCompare(b.fichier) || a.ligne - b.ligne), modulesSansImporteur, specificateursNonResolus: nonResolus };
const cible = process.argv[2];
if (cible) writeFileSync(cible, JSON.stringify(sortie, null, 2) + '\n');
console.log(JSON.stringify({ fichiersAnalyses: fichiers.length, exportsSansConsommateur: sansConsommateur.length, exportsConsommesParTemoinsSeuls: temoinsSeuls.length, modulesSansImporteur: modulesSansImporteur.length, specificateursNonResolus: nonResolus.length }));
