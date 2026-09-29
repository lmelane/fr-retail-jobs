/**
 * PASSE DE CURATION v3, ÉTAPE 6d : TIRAGE D'UN ÉCHANTILLON NEUF POUR LA MESURE DE JUSTESSE (plan
 * `docs/architecture/classification-metiers.md` §3.2 : « échantillon neuf de 200 rattachements par version »).
 *
 * 200 couples (intitulé, service) dont le métier est nouveau ou change en v3, jamais jugés auparavant, ordonnés par
 * empreinte SHA-256 salée (tirage reproductible). Le jugement (juste, proche, faux) et son compte sont consignés dans
 * `curation-v3/6d-mesure-justesse.json`, par un juge d'une autre famille de modèles que ceux de la passe.
 *
 *   node --import tsx apps/aggregator/scripts/taxonomie/curation/6d-echantillon-neuf.mts
 */
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { compileOccupationManifest } from '../../../../../packages/db/occupation-engine.ts';
import { DOSSIER_SORTIE as D } from './commun.mts';
const v1 = compileOccupationManifest(JSON.parse(readFileSync(D + 'entrees/catwalks-occupations-20260909-v1.json', 'utf8')));
const m = JSON.parse(readFileSync(D + '6-manifeste-v3.json', 'utf8')); const v3 = compileOccupationManifest(m);
const { couples } = JSON.parse(gunzipSync(readFileSync(D + 'entrees/offres-preview-2026-09-29.json.gz')).toString());
// Sans remise : aucun couple déjà jugé (tour 1 de la mesure, échantillon de la preview).
const vus = new Set([...JSON.parse(readFileSync(D + '6d-mesure-justesse.json', 'utf8')).tour1.verdicts, ...JSON.parse(readFileSync(D + '6b-preview.json', 'utf8')).echantillon].map((x: any) => `${x.titre}|${x.service}`));
const cand = couples.map((c: any) => ({ c, a: v1.classify(c.titre, c.service).occupationCode, b: v3.classify(c.titre, c.service).occupationCode }))
  .filter((x: any) => x.b && x.a !== x.b && !vus.has(`${x.c.titre}|${x.c.service}`));
const h = (x: any) => createHash('sha256').update(`echantillon-neuf-2026-09-29|${x.c.titre}|${x.c.service}`).digest('hex');
const e = cand.sort((x: any, y: any) => h(x).localeCompare(h(y))).slice(0, 200)
  .map((x: any) => ({ titre: x.c.titre, service: x.c.service, offres: x.c.offres, avant: x.a, metier: x.b, libelle: m.occupations.find((o: any) => o.key === x.b).labels.fr }));
writeFileSync(`${D}6d-echantillon-neuf.json`, JSON.stringify(e, null, 1));
console.log('candidats neufs :', cand.length);
e.forEach((x: any, n: number) => console.log(n + 1, '|', x.titre.replace(/\s+/g, ' ').slice(0, 62), '|', (x.service ?? '').slice(0, 14), '→', x.libelle));
