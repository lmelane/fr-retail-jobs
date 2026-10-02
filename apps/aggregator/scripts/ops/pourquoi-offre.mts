/**
 * `npm run pourquoi-offre -- …` — D-520 §3 : pourquoi une offre est exposée ou non, de bout en bout. LECTURE SEULE : tout
 * se lit dans une transaction `READ ONLY` (Postgres refuse toute écriture de la session, quel que soit le rôle), et rien
 * n'ouvre de `PipelineRun`.
 *
 *   <id | lien | source:identifiant>   le parcours complet d'une offre (texte ; --json pour la structure)
 *   --maison=<id | nom>                la répartition par état d'exposition d'une Maison (entités fusionnées comprises)
 *   --marche=<code>                    la répartition d'un marché ouvert (ou d'un pays)
 *   --repartition                      la répartition de tout le catalogue (--par-marche pour le détail)
 *   --verifier                         l'état EXPOSEE contre ce que sert la recherche (`publicJobSql` dans un marché ouvert)
 *   --echantillon=<n> [--graine=<g>]   n offres tirées au hasard dans chaque état, chacune expliquée (relecture à la main)
 *
 * Le verdict vient de `classifyExposure` (`src/coverage/offerExposure.ts`), la seule fonction de vérité.
 */
import { Prisma, PrismaClient } from '@prisma/client';
import { explainOffer, explanationText, readExposureDistribution, readExposureIds, verifyExposedAgainstSearch,
  type ExposureScope } from '../../src/coverage/offerExposureReading.js';

const args = process.argv.slice(2);
const value = (name: string) => args.find(a => a.startsWith(`--${name}=`))?.slice(name.length + 3);
const flag = (name: string) => args.includes(`--${name}`);
const positional = args.filter(a => !a.startsWith('--'));
const known = ['maison', 'marche', 'repartition', 'par-marche', 'verifier', 'echantillon', 'graine', 'json'];
const unknown = args.filter(a => a.startsWith('--') && !known.includes(a.slice(2).split('=')[0]));
if (unknown.length || positional.length > 1 || (!positional.length && !value('maison') && !value('marche') && !flag('repartition') && !flag('verifier') && !value('echantillon'))) {
  console.error('usage : pourquoi-offre <id | lien | source:identifiant> [--json] | --maison=<id|nom> | --marche=<code> | --repartition [--par-marche] | --verifier | --echantillon=<n> [--graine=<g>]');
  process.exit(2);
}

/** Tirage reproductible : la même graine rend le même échantillon (mulberry32). */
function shuffled<T>(items: readonly T[], seed: number): T[] {
  let a = seed >>> 0;
  const rand = () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [copy[i], copy[j]] = [copy[j], copy[i]]; }
  return copy;
}

const prisma = new PrismaClient({ errorFormat: 'minimal', log: [] });
try {
  const output = await prisma.$transaction(async tx => {
    await tx.$executeRaw`SET TRANSACTION READ ONLY`;
    const at = new Date();
    if (positional.length) {
      const explanation = await explainOffer(tx, positional[0], at);
      if (!explanation) return { text: [`Aucune offre ni publication pour « ${positional[0]} ».`], json: null, exit: 1 };
      return { text: explanationText(explanation), json: explanation, exit: 0 };
    }
    if (flag('verifier')) {
      const check = await verifyExposedAgainstSearch(tx, { at });
      const ok = check.onlyExposedCount === 0 && check.onlyServedCount === 0 && check.outsideMarketsMismatch === 0;
      return { text: [`EXPOSEE ${check.exposed} ; servies par la recherche dans un marché ouvert ${check.served} ; ${ok ? 'identiques' : `ÉCART : ${check.onlyExposedCount} exposées non servies, ${check.onlyServedCount} servies non exposées`}`,
        `Servies hors marché ouvert (sans pays, ou pays seul) ${check.publicOutsideMarkets} ; toutes HORS_MARCHE : ${check.outsideMarketsMismatch === 0 ? 'oui' : `non, ${check.outsideMarketsMismatch} écarts`}`],
        json: check, exit: ok ? 0 : 1 };
    }
    const sample = value('echantillon');
    if (sample) {
      const n = Number(sample), seed = Number(value('graine') ?? 20261002);
      if (!Number.isSafeInteger(n) || n < 1 || n > 200) throw new Error('--echantillon=<1..200>');
      const ids = await readExposureIds(tx, at);
      const picked: Array<{ cause: string; explanation: unknown }> = [], text: string[] = [];
      for (const [cause, list] of [...ids.entries()].sort()) {
        for (const id of shuffled(list, seed).slice(0, n)) {
          const e = await explainOffer(tx, id, at);
          picked.push({ cause, explanation: e });
          text.push(`════ ${cause} (${list.length} offres) ════`, ...(e ? explanationText(e) : [`${id} introuvable`]), '');
        }
      }
      return { text, json: picked, exit: 0 };
    }
    let scope: ExposureScope = { kind: 'CATALOGUE' };
    const maison = value('maison'), marche = value('marche');
    if (maison) {
      const rows = await tx.$queryRaw<Array<{ id: string; name: string; n: number }>>(Prisma.sql`
        SELECT c.id, c.name, (SELECT count(*)::int FROM "Job" j WHERE j."companyId" = c.id) AS n FROM "Company" c
        WHERE c.id = ${maison} OR lower(c.name) = lower(${maison}) OR c."canonicalKey" = upper(${maison}) ORDER BY n DESC LIMIT 5`);
      if (!rows.length) return { text: [`Aucune Maison « ${maison} ».`], json: null, exit: 1 };
      scope = { kind: 'MAISON', companyId: rows[0].id };
    } else if (marche) scope = { kind: 'MARCHE', code: marche };
    const d = await readExposureDistribution(tx, { at, scope, byMarket: flag('par-marche') });
    const n = (v: number) => v.toLocaleString('fr-FR');
    const text = [`${d.scope.label} — ${n(d.counts.total)} offres au ${d.at}${d.schema.availabilityHold ? '' : ' (base sans retenue R-143 §2)'}`,
      ...Object.entries(d.counts.byState).filter(([, v]) => v > 0).map(([s, v]) => `  ${s.padEnd(18)} ${n(v).padStart(8)}`),
      '  par cause :', ...Object.entries(d.counts.byCause).sort((a, b) => b[1] - a[1]).map(([c, v]) => `    ${c.padEnd(42)} ${n(v).padStart(8)}`),
      ...(d.identityReview ? [`  publications en revue d’identité (non rattachées) : ${n(d.identityReview)}`] : []),
      ...(Object.keys(d.retainedAtCollection ?? {}).length ? ['  publications retenues dès la collecte, jamais publiées :',
        ...Object.entries(d.retainedAtCollection!).sort((a, b) => b[1] - a[1]).map(([c, v]) => `    ${c.padEnd(42)} ${n(v).padStart(8)}`)] : []),
      `  sans cause : ${n(d.counts.byState.INEXPLIQUEE)}${d.unexplained.length ? ` (${d.unexplained.slice(0, 10).map(u => `${u.id} : ${u.detail}`).join(' ; ')})` : ''}`,
      ...(d.byMarket ?? []).map(m => `  ${m.market.padEnd(12)} ${n(m.counts.total).padStart(7)} : ${Object.entries(m.counts.byState).filter(([, v]) => v > 0).map(([s, v]) => `${s} ${n(v)}`).join(', ')}`)];
    return { text, json: d, exit: 0 };
  }, { isolationLevel: 'RepeatableRead', timeout: 900_000, maxWait: 10_000 });
  console.log(flag('json') ? JSON.stringify(output.json, null, 2) : output.text.join('\n'));
  process.exitCode = output.exit;
} finally {
  await prisma.$disconnect();
}
