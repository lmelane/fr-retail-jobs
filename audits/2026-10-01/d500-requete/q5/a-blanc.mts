/**
 * D-500 (Q5) — LE RECLASSEMENT À BLANC, en LECTURE SEULE sur la production : pour chaque offre active, les métiers lus
 * dans son intitulé (`titleRoles`) par la v3 active et par la v3.1 (`manifeste-v3-1.json`, lecture 2), à partir de son
 * intitulé et de la décision du moteur stockés. Rien n'est écrit en base.
 *
 * Sorties (`q5/resultats/`) :
 *  - `bilan.txt` : offres qui gagnent un métier, par métier et par marché ; contrôle (la v3 recalculée ici rend-elle les
 *    `titleRoles` stockés ?) ; couverture des offres françaises que le texte trouve et que `metier=sales-advisor` ne
 *    retient pas (`../resultats/q5-hors-metier-sales-advisor-FR.json`) ;
 *  - `gains.json` : toutes les offres qui gagnent un métier (identifiant, pays, intitulé, métiers avant et après) ;
 *  - `echantillon.json` : un tirage NEUF (graine datée) de couples « intitulé → métier gagné » pour la mesure de justesse,
 *    sans aucun verdict.
 *
 *   CATWALKS_DB_ACCESS=<accès> npx tsx audits/2026-10-01/d500-requete/q5/manifeste-v3-1.mts
 *   CATWALKS_DB_ACCESS=<accès> npx tsx audits/2026-10-01/d500-requete/q5/a-blanc.mts <dossier de sortie> [taille] [actives|fermees]
 * `fermees` : les offres FERMÉES du stock (jamais lues par le tour précédent), pour un échantillon neuf ; le reclassement
 * (`classify-jobs`) les relit aussi.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { executer } from '../client-mesure.mts';
import { compileOccupationManifest, occupationTitleRoles } from '@catwalks/db/occupations';

const ICI = new URL('.', import.meta.url).pathname;
const SORTIE = join(ICI, process.argv[2] ?? 'resultats');
mkdirSync(SORTIE, { recursive: true });
const TAILLE = Number(process.argv[3] ?? 200);
const POPULATION = process.argv[4] === 'fermees' ? 'fermees' : 'actives';
const GRAINE = `d500-q5-2026-10-01-${POPULATION}`;
const lire = (f: string) => JSON.parse(readFileSync(f, 'utf8'));
const v3 = compileOccupationManifest(lire(join(ICI, '..', '..', '..', '2026-09-28', 'curation-v3', '6-manifeste-v3.json')));
const v31 = compileOccupationManifest(lire(join(ICI, 'manifeste-v3-1.json')));

type Offre = { id: string; pays: string | null; title: string; code: string | null; statut: string; candidates: string[] | null;
  regles: string[] | null; stockes: string[]; release: string | null };
const offres = executer(`SELECT j.id, j."countryCode" AS pays, j.title, j."occupationCode" AS code, j."occupationStatus" AS statut,
    j."occupationEvidence"->'candidates' AS candidates, j."occupationEvidence"->'matchedRules' AS regles, j."titleRoles" AS stockes,
    j."titleRolesReleaseId" AS release
  FROM "Job" j WHERE ${POPULATION === 'actives' ? 'j."isActive"' : 'NOT j."isActive"'} AND j."mergedIntoId" IS NULL`).lignes as Offre[];
const decision = (o: Offre) => ({ occupationCode: o.code, occupationStatus: o.statut,
  occupationEvidence: { candidates: o.candidates ?? [], matchedRules: o.regles ?? [] } });

let controleOk = 0, controleKo = 0;
const exemplesKo: string[] = [];
const gains: { id: string; pays: string | null; titre: string; code: string | null; avant: string[]; apres: string[]; gagnes: string[] }[] = [];
let perdus = 0;
for (const o of offres) {
  const avant = occupationTitleRoles(v3, o.title, decision(o));
  const apres = occupationTitleRoles(v31, o.title, decision(o));
  if (o.release === v3.manifest.id) {
    if (JSON.stringify([...o.stockes].sort()) === JSON.stringify(avant)) controleOk++;
    else { controleKo++; if (exemplesKo.length < 5) exemplesKo.push(`${o.title} : stockés ${o.stockes.join('+')} / recalculés ${avant.join('+')}`); }
  }
  if (avant.some((r) => !apres.includes(r))) perdus++;
  const gagnes = apres.filter((r) => !avant.includes(r) && r !== o.code);
  if (gagnes.length) gains.push({ id: o.id, pays: o.pays, titre: o.title, code: o.code, avant, apres, gagnes });
}

// Couverture des offres françaises trouvées par le texte et pas par le métier (mesure de ce lot).
const horsMetier = lire(join(ICI, '..', 'resultats', 'q5-hors-metier-sales-advisor-FR.json')) as { lignes: { id: string; title: string }[] };
const parId = new Map(gains.map((g) => [g.id, g]));
const rattachees = horsMetier.lignes.filter((l) => parId.get(l.id)?.gagnes.includes('sales-advisor'));
// Les offres de ce lot dont l'intitulé nomme le métier au pluriel ou en écriture inclusive (« Vendeurs », « Conseiller.e de
// ventes »), et non un autre métier trouvé par ses missions (« Chargé d'expérience client »).
const NOMME = /\bvendeu|conseill\w*[.·(]?\w*\)? de ventes?\b|conseill\w*[ ,]+vendeu/i;
const visees = horsMetier.lignes.filter((l) => NOMME.test(l.title));
const viseesRattachees = visees.filter((l) => parId.get(l.id)?.gagnes.includes('sales-advisor'));

// Le tirage : un couple (offre, métier gagné) par offre, ordonné par empreinte de la graine ; aucun verdict ici.
const empreinte = (s: string) => createHash('sha256').update(`${GRAINE}|${s}`).digest('hex');
const echantillon = gains.map((g) => ({ id: g.id, pays: g.pays, titre: g.titre, metier: g.gagnes[0],
  libelle: (v31.occupations.get(g.gagnes[0])?.labels as Record<string, string> | undefined)?.fr ?? g.gagnes[0],
  definition: (v31.occupations.get(g.gagnes[0]) as { definition?: string } | undefined)?.definition ?? null }))
  .sort((a, b) => empreinte(a.id).localeCompare(empreinte(b.id))).slice(0, TAILLE)
  .map((c, i) => ({ n: i + 1, ...c }));

const parMetier = new Map<string, number>(), parPays = new Map<string, number>();
for (const g of gains) {
  for (const r of g.gagnes) parMetier.set(r, (parMetier.get(r) ?? 0) + 1);
  parPays.set(g.pays ?? '-', (parPays.get(g.pays ?? '-') ?? 0) + 1);
}
const tri = (m: Map<string, number>) => [...m].sort((a, b) => b[1] - a[1]);
const lecture = [
  `# Q5 à blanc — ${new Date().toISOString()} — ${v3.manifest.id} → ${v31.manifest.id}`,
  `Offres ${POPULATION} lues : ${offres.length}`,
  `Contrôle : titleRoles stockés (version ${v3.manifest.id}) = recalculés ici : ${controleOk} ; différents : ${controleKo}${exemplesKo.length ? ` (${exemplesKo.join(' ‖ ')})` : ''}`,
  `Offres qui gagnent au moins un métier lu : ${gains.length} ; offres qui en perdent un : ${perdus}`,
  `Par métier gagné : ${tri(parMetier).slice(0, 25).map(([k, n]) => `${k} ${n}`).join(', ')}`,
  `Par pays : ${tri(parPays).map(([k, n]) => `${k} ${n}`).join(', ')}`,
  '',
  `Offres françaises que le texte trouve et que metier=sales-advisor ne retient pas : ${horsMetier.lignes.length}`,
  `  rattachées au Conseiller de vente par la v3.1 : ${rattachees.length} (${((100 * rattachees.length) / horsMetier.lignes.length).toFixed(1)} %)`,
  `  dont l'intitulé nomme le métier au pluriel ou en écriture inclusive : ${visees.length} ; rattachées : ${viseesRattachees.length} (${visees.length ? ((100 * viseesRattachees.length) / visees.length).toFixed(1) : '-'} %)`,
  `  non rattachées parmi elles : ${visees.filter((l) => !viseesRattachees.includes(l)).map((l) => l.title).slice(0, 15).join(' ‖ ') || '-'}`,
  '',
  `Échantillon de justesse : ${echantillon.length} couples, graine « ${GRAINE} » (echantillon.json, sans verdict)`,
];
writeFileSync(join(SORTIE, 'bilan-a-blanc.txt'), lecture.join('\n') + '\n');
writeFileSync(join(SORTIE, 'gains.json'), JSON.stringify(gains, null, 1));
writeFileSync(join(SORTIE, 'echantillon.json'), JSON.stringify(echantillon, null, 1));
console.log(lecture.join('\n'));
process.exit(0);
