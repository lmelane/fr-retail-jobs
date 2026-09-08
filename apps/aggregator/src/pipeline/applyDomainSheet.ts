import { readFileSync } from 'node:fs';
import type { PrismaClient } from '@prisma/client';

/**
 * Applique le référentiel de domaines établi à la main par Loïc
 * (`data/maisons-domaines-loic.tsv`, 652 Maisons, 2026-09-07).
 *
 * Trois statuts, trois traitements — c'est la distinction qui compte :
 *
 *  - **IDENTIFIÉ** : la Maison existe, on lui pose son domaine. Le logo suit.
 *  - **RATTACHÉ** : la ligne n'est PAS une Maison, c'est une entité juridique
 *    ou un pays de la marque mère (« MANGO TR TEKSTIL TICARET LTD.S », « NIKE
 *    Korea LLC », « Michael Kors (Portugal) »). Poser le domaine afficherait
 *    le bon logo mais laisserait 32 « Mango » dans les filtres, les classements
 *    et l'observatoire. On FUSIONNE l'identité dans la marque mère.
 *  - **À VÉRIFIER** : nom trop ambigu pour attribuer un domaine sans risque
 *    (« B2 », « KENT », « Public »). On ne touche à rien : monogramme.
 *
 * La fusion conserve id, URL et `firstSeenAt` des offres (stabilité D22) : la
 * clé de cluster et l'empreinte commencent par l'identité de société, on
 * remplace ce seul préfixe.
 *
 * Idempotente. Sans `apply`, elle mesure et n'écrit rien.
 */

export type DomainRow = {
  maison: string;
  domain: string;
  status: 'IDENTIFIÉ' | 'RATTACHÉ' | 'À VÉRIFIER';
  /** Marque mère, extraite de la note, pour les lignes RATTACHÉ. */
  parent: string | null;
};

/** « Entité juridique / pays rattachée à Mango. » → « Mango ». */
export function parentFromNote(note: string): string | null {
  // `[^;]+?` puis un point final : « lvmh.com » ne doit pas être tronqué en
  // « lvmh », sinon un domaine passerait pour un nom de société.
  const m = note.match(/rattach[ée]e? (?:à|au domaine du groupe|aux?)\s+([^;]+?)\s*\.?\s*$/i);
  if (!m) return null;
  const name = m[1].trim();
  // « au domaine du groupe » ne nomme personne ; « à lvmh.com » nomme un
  // DOMAINE, pas une société — dans les deux cas on ne peut pas fusionner.
  if (!name || /^(domaine|groupe)/i.test(name) || /^[a-z0-9.-]+\.[a-z]{2,}$/i.test(name)) return null;
  return name;
}

export function parseDomainSheet(tsv: string): DomainRow[] {
  const [head, ...lines] = tsv.trim().split('\n');
  const cols = head.split('\t').map((c) => c.trim());
  const at = (name: string) => cols.findIndex((c) => c.toLowerCase().startsWith(name));
  const iName = at('maison');
  const iDomain = at('site officiel');
  const iStatus = at('statut');
  const iNote = at('note');
  if (iName < 0 || iDomain < 0 || iStatus < 0) throw new Error('colonnes attendues : Maison, Site officiel, Statut');

  const rows: DomainRow[] = [];
  for (const line of lines) {
    const c = line.split('\t');
    const maison = (c[iName] ?? '').trim();
    if (!maison) continue;
    const status = (c[iStatus] ?? '').trim() as DomainRow['status'];
    const note = (c[iNote] ?? '').trim();
    rows.push({
      maison,
      domain: (c[iDomain] ?? '').trim().toLowerCase(),
      status,
      parent: status === 'RATTACHÉ' ? parentFromNote(note) : null,
    });
  }
  return rows;
}

export type ApplyStats = {
  read: number;
  domainsSet: number;
  domainsAlready: number;
  merged: number;
  jobsMoved: number;
  skippedUnverified: number;
  notFound: string[];
  parentMissing: string[];
  conflicts: string[];
};

/** Un hôte simple : lettres, chiffres, tirets et points. Rien d'autre. */
const DOMAIN_RE = /^[a-z0-9-]{1,63}(\.[a-z0-9-]{1,63}){1,3}$/;

export async function applyDomainSheet(
  prisma: PrismaClient,
  file: string,
  options: { apply?: boolean } = {},
): Promise<ApplyStats> {
  const rows = parseDomainSheet(readFileSync(file, 'utf8'));
  const stats: ApplyStats = {
    read: rows.length, domainsSet: 0, domainsAlready: 0, merged: 0, jobsMoved: 0,
    skippedUnverified: 0, notFound: [], parentMissing: [], conflicts: [],
  };

  type Co = { id: string; name: string; domain: string | null; canonicalKey: string };
  // Index insensible à la casse : la mère s'appelle « NIKE » / « UNIQLO » en
  // base là où la note dit « Nike » / « Uniqlo ». À nom identique, la société
  // qui porte le plus d'offres actives gagne.
  const byName = new Map<string, Co>();
  const key = (n: string) => n.trim().toLowerCase();
  const all = await prisma.company.findMany({
    select: { id: true, name: true, domain: true, canonicalKey: true, _count: { select: { jobs: { where: { isActive: true } } } } },
    orderBy: { jobs: { _count: 'desc' } },
  });
  for (const c of all) {
    const k = key(c.name);
    if (!byName.has(k)) byName.set(k, { id: c.id, name: c.name, domain: c.domain, canonicalKey: c.canonicalKey });
  }

  for (const row of rows) {
    if (row.status === 'À VÉRIFIER') { stats.skippedUnverified++; continue; }

    const company = byName.get(key(row.maison));
    if (!company) { stats.notFound.push(row.maison); continue; }

    if (row.domain && !DOMAIN_RE.test(row.domain)) { stats.conflicts.push(`${row.maison}: domaine invalide « ${row.domain} »`); continue; }

    // — RATTACHÉ : fusion d'identité dans la marque mère —
    if (row.status === 'RATTACHÉ' && row.parent) {
      const parent = byName.get(key(row.parent));
      if (!parent) { stats.parentMissing.push(`${row.maison} → ${row.parent}`); continue; }
      if (parent.id === company.id) continue; // déjà fusionnée

      const jobs = await prisma.job.findMany({
        where: { companyId: company.id },
        select: { id: true, clusterKey: true, fingerprint: true },
      });
      stats.merged++;
      stats.jobsMoved += jobs.length;
      if (!options.apply) continue;

      for (const j of jobs) {
        await prisma.job.update({
          where: { id: j.id },
          data: {
            companyId: parent.id,
            // `clusterKey` est nullable en base : une offre née avant la clé de
            // cluster n'en porte pas. On ne réécrit que ce qui existe — comme le
            // fingerprint juste en dessous — au lieu de déréférencer un null.
            ...(j.clusterKey
              ? { clusterKey: j.clusterKey.replace(`${company.canonicalKey}|`, `${parent.canonicalKey}|`) }
              : {}),
            ...(j.fingerprint ? { fingerprint: j.fingerprint.replace(`${company.canonicalKey}|`, `${parent.canonicalKey}|`) } : {}),
          },
        });
      }
      // La société vidée disparaît ; si une offre subsiste (course avec un
      // ingest), on la laisse vivre plutôt que de casser une clé étrangère.
      const left = await prisma.job.count({ where: { companyId: company.id } });
      if (left === 0) await prisma.company.delete({ where: { id: company.id } });
      byName.delete(key(row.maison));
      continue;
    }

    // — IDENTIFIÉ (et RATTACHÉ sans mère nommée) : on pose le domaine —
    if (!row.domain) continue;
    if (company.domain === row.domain) { stats.domainsAlready++; continue; }
    stats.domainsSet++;
    if (!options.apply) continue;
    await prisma.company.update({
      where: { id: company.id },
      data: { domain: row.domain, domainSource: 'manual' },
    });
  }

  return stats;
}
