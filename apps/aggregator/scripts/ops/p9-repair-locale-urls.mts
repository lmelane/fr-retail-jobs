/**
 * RÉPARER HORS LIGNE LES URLS SANS SEGMENT DE LOCALE.
 *
 * Le défaut d'origine construisait `<origin>/job/<id>/<slug>` au lieu de `<origin>/<locale>/job/<id>/<slug>`.
 * Le publieur répond **HTTP 200** sur la forme fautive puis redirige vers `/global/en` : le lien « Postuler »
 * mène à une page de recherche, et rien dans un contrôle de statut ne le signale.
 *
 * Deux passages d'ingestion ont réparé ce que le publieur a bien voulu resservir ; sa pagination étant
 * instable, 79 lignes n'ont jamais été revues. Les re-collecter serait un pari sur le tirage du publieur —
 * alors que l'URL correcte est **entièrement dérivable** de la ligne : c'est la même chaîne, avec le segment
 * de locale de la configuration inséré. On n'invente rien, on applique la règle de l'adaptateur.
 *
 * GARDES : on ne touche qu'une URL de la forme fautive EXACTE, on n'écrit que si la page réparée porte
 * l'identifiant de l'offre, et `--apply` est requis. Une URL qui échoue la vérification reste inchangée.
 *
 * usage: db.py production npx tsx scripts/ops/p9-repair-locale-urls.mts --keys=a,b [--apply]
 */
import { PrismaClient } from '@prisma/client';
import { CRAWLER_IDENTITY } from '../../src/lib/crawlerIdentity.js';

const arg = (n: string) => process.argv.find((a) => a.startsWith(`--${n}=`))?.slice(n.length + 3);
const KEYS = (arg('keys') ?? 'hugo-boss-phenom,skechers-phenom').split(',');
const APPLY = process.argv.includes('--apply');
const p = new PrismaClient();

for (const key of KEYS) {
  const src = await p.source.findUnique({ where: { key }, select: { config: true } });
  const cfg: any = src?.config ?? {};
  const origin = String(cfg.origin ?? '').replace(/\/$/, '');
  const locale = String(cfg.localePath ?? '').replace(/^\/|\/$/g, '');
  if (!origin || !locale) { console.log(`${key}: pas de localePath configuré — ABSTENTION`); continue; }

  const rows = await p.jobSource.findMany({
    where: { sourceKey: key, job: { isActive: true } },
    select: { externalId: true, jobId: true, job: { select: { url: true } } },
  });
  // La forme fautive, et elle seule : <origin>/job/... sans le segment de locale.
  const broken = rows.filter((r) => r.job.url?.startsWith(`${origin}/job/`));
  let repaired = 0, refused = 0;

  for (const r of broken) {
    const fixed = r.job.url!.replace(`${origin}/job/`, `${origin}/${locale}/job/`);
    const id = String(r.externalId).match(/\d+/)?.[0] ?? '';
    let carries = false;
    try {
      const res = await fetch(fixed, { headers: { 'user-agent': CRAWLER_IDENTITY }, redirect: 'follow', signal: AbortSignal.timeout(25_000) });
      carries = res.status === 200 && (id ? (await res.text()).includes(id) : false);
    } catch { carries = false; }

    if (!carries) { refused++; continue; }          // la preuve manque : on ne touche pas.
    if (APPLY) await p.job.update({ where: { id: r.jobId }, data: { url: fixed } });
    repaired++;
  }
  console.log(JSON.stringify({ source: key, fautives: broken.length, reparables: repaired, refusees: refused, applique: APPLY }));
}
await p.$disconnect();
