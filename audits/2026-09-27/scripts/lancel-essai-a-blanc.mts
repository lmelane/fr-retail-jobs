/**
 * LANCEL PAR L'ADAPTATEUR GÉNÉRIQUE EXISTANT — essai à blanc, prémisse de D-471 §5.
 *
 * ── LA QUESTION ──────────────────────────────────────────────────────────────────────────────
 *
 * Le site carrière de Lancel (`lancel.nous-recrutons.fr`, un site Beetween sur WordPress et WP Job Manager) peut-il
 * entrer au catalogue SANS code nouveau ? On lit son plan de site d'offres avec l'adaptateur générique JSON-LD tel
 * qu'une source `generic-listing` le ferait (`sitemapUrl`, `linkPattern: /poste/`), et l'on compte : offres lues,
 * énumération prouvée ou non, pays, employeur. Puis on compare leurs intitulés et villes aux offres que Catwalks
 * publie pour Lancel (liste publique du backend) : un même poste en double serait un arbitrage métier.
 *
 * ── CE QUE LE SCRIPT FAIT, ET NE FAIT PAS ────────────────────────────────────────────────────
 *
 * Des GET publics (le plan de site, 33 pages d'offres au 27/09/2026, la liste publique du backend), robots.txt
 * autorisant tout. Aucune base, aucune écriture. `ESSAI_SANS_NAT64=1` retire du DNS les adresses NAT64 synthétisées
 * (`64:ff9b::/96`) qu'un poste sur un réseau IPv6 seul reçoit, et que le garde anti-SSRF refuse à raison ; le code du
 * dépôt n'est pas modifié.
 *
 *   ESSAI_SANS_NAT64=1 npx tsx audits/2026-09-27/scripts/lancel-essai-a-blanc.mts
 */
import dns from 'node:dns';
import { syncBuiltinESMExports } from 'node:module';

if (process.env.ESSAI_SANS_NAT64 === '1') {
  const origine = dns.lookup;
  (dns as unknown as { lookup: unknown }).lookup = (h: string, o: unknown, cb?: unknown) => {
    const rappel = (typeof o === 'function' ? o : cb) as (e: unknown, a?: unknown, f?: number) => void;
    const options = (typeof o === 'object' && o) || {};
    return origine(h, { ...(options as object), all: true }, (e, r) => {
      if (e) return rappel(e);
      const garde = (r as unknown as { address: string; family: number }[]).filter((a) => !a.address.toLowerCase().startsWith('64:ff9b::'));
      return (options as { all?: boolean }).all ? rappel(null, garde) : rappel(null, garde[0]?.address, garde[0]?.family);
    });
  };
  syncBuiltinESMExports();
}
const { fetchGenericJsonLdJobs } = await import('../../../apps/aggregator/src/ats/adapters/genericJsonLd.js');

const r = await fetchGenericJsonLdJobs({ sitemapUrl: 'https://lancel.nous-recrutons.fr/job_listing-sitemap.xml', linkPattern: '/poste/', concurrency: 2 });
const compte = (f: (j: (typeof r.jobs)[number]) => unknown) =>
  r.jobs.reduce<Record<string, number>>((a, j) => { const k = String(f(j) ?? '(vide)'); a[k] = (a[k] ?? 0) + 1; return a; }, {});
console.log(JSON.stringify({
  offres: r.jobs.length, annoncees: r.declaredTotal, complete: (r as { complete?: boolean }).complete ?? null,
  methode: r.enumeration?.method, fin: r.enumeration?.termination, anomalies: r.enumeration?.issues ?? [],
  pays: compte((j) => j.country), employeur: compte((j) => j.company),
}));

const liste = await (await fetch('https://catwalks.api.catwalks.io/api/jobs')).json() as Array<{ title: string; city: string | null; maison: { name: string } | null }>;
const catwalks = liste.filter((o) => o.maison?.name?.toLowerCase() === 'lancel').map((o) => ({ titre: o.title, ville: o.city }));
const cle = (titre: string, ville: string | null | undefined) => `${titre.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z]+/g, ' ').trim()}|${(ville ?? '').toLowerCase()}`;
const lancel = new Set(r.jobs.map((j) => cle(j.title, j.city)));
console.log(JSON.stringify({ offresCatwalksPourLancel: catwalks, memePosteMemeVille: catwalks.filter((o) => lancel.has(cle(o.titre, o.ville))).length }));
