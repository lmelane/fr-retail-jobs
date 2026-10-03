import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { describe, expect, it } from 'vitest';

/**
 * D-522 §5 — LA FRONTIÈRE DES ROUTES DE PILOTAGE. Les routes `/api/ops/*` réutilisent les lecteurs du worker
 * (`@catwalks/aggregator/src/…`) au lieu de requêtes parallèles ; elles ne doivent pour autant JAMAIS embarquer la chaîne
 * de capture dans l'API du catalogue (navigateur Playwright, client HTTP, stockage d'objets, analyseur HTML). Mesuré le
 * 03/10/2026 avant l'extraction des lecteurs : `readSourceStatesReport` seul en tirait 32 modules, dont `playwright` et
 * `undici`, par `lib/ingestionIssue.ts` ; `explainOffer`, 73 modules, dont `@aws-sdk/client-s3` et `cheerio`.
 *
 * Le témoin regroupe RÉELLEMENT les six routes (esbuild suit chaque import, comme le bundler de Next) et relève chaque
 * paquet atteint hors du dépôt. Il échoue si un lecteur réimporte un module du worker (preuve : rétablir
 * `../lib/ingestionIssue.js` dans `pipeline/sourceState.ts` le fait passer au rouge).
 */
const api = fileURLToPath(new URL('..', import.meta.url));
const AUTORISES = /^(node:|@prisma\/client$|@catwalks\/db(\/|$)|next\/server$)/;
const INTERDITS = ['playwright', 'undici', 'cheerio', '@aws-sdk/client-s3', 'tough-cookie', 'tldts', 'p-limit', 'fast-xml-parser'];

function routes(dir: string): string[] {
  return readdirSync(dir).flatMap(nom => {
    const chemin = join(dir, nom);
    return statSync(chemin).isDirectory() ? routes(chemin) : nom === 'route.ts' ? [chemin] : [];
  });
}

describe('routes de pilotage : aucune dépendance du worker', () => {
  it('les six routes /api/ops/* existent', () => {
    expect(routes(join(api, 'app/api/ops')).map(r => r.slice(api.length)).sort()).toEqual([
      'app/api/ops/couverture/route.ts', 'app/api/ops/file-revue/route.ts', 'app/api/ops/pourquoi/route.ts',
      'app/api/ops/sources/[cle]/route.ts', 'app/api/ops/sources/route.ts', 'app/api/ops/vue-ensemble/route.ts']);
  });

  it('ne tirent que Prisma, le paquet db, Next et Node, et atteignent bien les lecteurs du worker', async () => {
    const externes = new Set<string>();
    const resultat = await build({
      entryPoints: routes(join(api, 'app/api/ops')), bundle: true, write: false, platform: 'node', format: 'esm', metafile: true,
      outdir: join(api, '.ops-frontiere'), tsconfig: join(api, 'tsconfig.json'), logLevel: 'silent',
      plugins: [{ name: 'externes', setup(b) {
        b.onResolve({ filter: /^[^./]/ }, args => {
          if (args.path.startsWith('@/') || args.path.startsWith('@catwalks/aggregator/')) return undefined;
          externes.add(args.path);
          return { path: args.path, external: true };
        });
      } }],
    });
    const atteints = [...externes].sort();
    for (const interdit of INTERDITS)
      expect(atteints.filter(p => p === interdit || p.startsWith(`${interdit}/`)), `paquet du worker atteint : ${interdit}`).toEqual([]);
    expect(atteints.filter(p => !AUTORISES.test(p)), 'paquet inattendu').toEqual([]);
    // Prémisse : le regroupement a bien suivi les lecteurs du worker (sinon le témoin ne prouverait rien).
    const modules = Object.keys(resultat.metafile!.inputs).map(m => m.replace(/\\/g, '/'));
    for (const lecteur of ['pipeline/sourceStateRead.ts', 'pipeline/sourceState.ts', 'registry/explicitRegistryRead.ts', 'pipeline/healthReport.ts',
      'identity/reviewQueue.ts', 'coverage/offerExposureReading.ts', 'coverage/coverageReading.ts', 'pipeline/runReading.ts'])
      expect(modules.some(m => /(^|\/)aggregator\/src\//.test(m) && m.endsWith(`src/${lecteur}`)), lecteur).toBe(true);
    expect(modules.some(m => m.endsWith('aggregator/src/lib/ingestionIssue.ts')), 'chaîne de capture atteinte').toBe(false);
  }, 60_000);
});
