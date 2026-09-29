/**
 * PASSE DE CURATION v3, ÉTAPE 6f : JUSTESSE DES MÉTIERS LUS DANS L'INTITULÉ (D-475 point 38 : « la justesse se mesure
 * sur un échantillon avant tout remplissage »).
 *
 * Population : les couples (intitulé, service) du corpus où la lecture (packages/db/occupation-title-roles.ts) AJOUTE
 * un métier aux candidats du moteur ; un couple compte autant de fois que d'offres. Même protocole que l'étape 6d :
 *  1. `--tirer` : jusqu'à 200 couples tirés sans remise en proportion des offres (Efraimidis-Spirakis, aléa tiré d'une
 *     empreinte : reproductible), écrits dans `6f-roles-lus.json` avec l'empreinte du manifeste, AVANT tout jugement ;
 *  2. les verdicts de l'assistant, ajoutés au fichier et committés AVANT ceux du modèle ;
 *  3. `--juger-modele` : le juge de mesure (aucun rattachement de la passe) note chaque métier ajouté ;
 *  4. `--compter` : part des offres dont un métier ajouté est faux, et borne haute de Wilson à 95 %.
 * Grille : C l'offre est bien un poste de ce métier ; P métier voisin (niveau, spécialité) ; F un autre métier.
 *
 * Tour 1 (29/09/2026) : 18,5 % de faux selon l'assistant, 16,5 % selon le juge ; la lecture reprenait les généralisations
 * rejetées par 6c. Tour 2 et suivants (`--tour N`) : après l'étape 6g, sur un tirage NEUF (autre sel, autre fichier) ;
 * le juge voit la famille du métier dès le tour 3, la grille de 6g (`GRILLE_METIER_LU`) dès le tour 4.
 *
 *   node [--env-file=<.env portant GEMINI_API_KEY>] --import tsx apps/aggregator/scripts/taxonomie/curation/6f-roles-lus.mts [--tour N] --tirer|--juger-modele|--compter
 */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { compileOccupationManifest, occupationTitleRoles } from '../../../../../packages/db/occupations.ts';
import { DOSSIER_SORTIE as D, GRILLE_METIER_LU, lireEtape } from './commun.mts';

const TOUR = Number(process.argv[process.argv.indexOf('--tour') + 1] ?? 1) || 1;
const FICHIER = `${D}6f-roles-lus${TOUR > 1 ? `-t${TOUR}` : ''}.json`;
const JUGE_MESURE = 'gemini-3.1-pro-preview';
const mode = process.argv.find((a) => ['--tirer', '--juger-modele', '--compter'].includes(a));
const empreinte = () => createHash('sha256').update(readFileSync(`${D}6-manifeste-v3.json`)).digest('hex');

if (mode === '--tirer') {
  if (existsSync(FICHIER)) throw new Error('échantillon déjà tiré : il ne se retire pas (enregistré avant jugement)');
  const m = lireEtape('6-manifeste-v3.json'), v3 = compileOccupationManifest(m);
  const { couples } = JSON.parse(gunzipSync(readFileSync(`${D}entrees/offres-preview-2026-09-29.json.gz`)).toString('utf8'));
  const libelle = (k: string) => m.occupations.find((o: any) => o.key === k)?.labels.fr ?? k;
  const population = couples.map((c: any) => {
    const d = v3.classify(c.titre, c.service);
    const ajoutes = occupationTitleRoles(v3, c.titre, d).filter((r) => !d.occupationEvidence.candidates.includes(r));
    return { c, d, ajoutes };
  }).filter((x: any) => x.ajoutes.length);
  const alea = (x: any) => (parseInt(createHash('sha256').update(`roles-lus-2026-09-29${TOUR > 1 ? `-t${TOUR}` : ''}|${x.c.titre}|${x.c.service}`).digest('hex').slice(0, 12), 16) + 1) / 2 ** 48;
  const e = population.map((x: any) => ({ x, k: Math.log(alea(x)) / x.c.offres })).sort((p: any, q: any) => q.k - p.k).slice(0, 200)
    .map(({ x }: any) => ({ titre: x.c.titre, service: x.c.service, offres: x.c.offres, moteur: x.d.occupationCode, statut: x.d.occupationStatus,
      ajoutes: x.ajoutes.map((k: string) => ({ cle: k, libelle: libelle(k) })), verdictAssistant: null, verdictModele: null }));
  writeFileSync(FICHIER, JSON.stringify({ tireLe: new Date().toISOString(), tour: TOUR, manifeste: m.id, empreinteManifeste: empreinte(),
    population: { couples: population.length, offres: population.reduce((n: number, x: any) => n + x.c.offres, 0) }, echantillon: e }, null, 1));
  console.log(`tiré : ${e.length} sur ${population.length} couples (${population.reduce((n: number, x: any) => n + x.c.offres, 0)} offres)`);
}

if (mode === '--juger-modele') {
  const { JUGES, MODELE_CHOIX, repondre } = await import('./ia.mts');
  const o = JSON.parse(readFileSync(FICHIER, 'utf8'));
  if (o.empreinteManifeste !== empreinte()) throw new Error('le manifeste a changé depuis le tirage');
  if (o.echantillon.some((x: any) => !x.verdictAssistant)) throw new Error('verdicts de l\'assistant manquants : ils se committent AVANT ceux du modèle');
  if ((Object.values(JUGES) as string[]).includes(JUGE_MESURE) || (JUGE_MESURE as string) === MODELE_CHOIX) throw new Error('le juge de mesure a servi aux rattachements');
  const CONSIGNE = `Tu évalues, pour un job board du luxe, de la mode et de la beauté, le métier qu'on lit dans l'intitulé d'une offre pour qu'une recherche par ce métier la retrouve. Pour chaque offre (intitulé, service), note le métier lu : "C" l'offre est bien un poste de ce métier ; "P" métier voisin (niveau ou spécialité proche) ; "F" un autre métier (règle du produit : un poste d'encadrement est un autre métier que celui qu'il encadre).${(o.tour ?? 1) >= 3 ? ' Le métier se comprend dans sa famille, indiquée.' : ''}`;
  // Dès le tour 4, la grille est celle de la vérification (étape 6g), une seule pour les deux.
  const consigne = (o.tour ?? 1) >= 4 ? GRILLE_METIER_LU : CONSIGNE;
  const SCHEMA = { type: 'OBJECT', properties: { i: { type: 'INTEGER' }, verdict: { type: 'STRING', enum: ['C', 'P', 'F'] } }, required: ['i', 'verdict'] };
  // Dès le tour 3, le juge voit la famille du métier lu, comme les juges de 6g (« Operations Manager » est celui des
  // opérations de boutique) ; les tours 1 et 2 l'ont jugé sans.
  const m = lireEtape('6-manifeste-v3.json');
  const famille = (k: string) => m.families.find((f: any) => f.key === m.occupations.find((o: any) => o.key === k)?.family)?.labels.fr;
  const lu = (a: any) => (o.tour ?? 1) >= 3 ? `${a.libelle} (famille : ${famille(a.cle)})` : a.libelle;
  const rendu = (lot: any[]) => lot.map((x, j) => `[${j}] « ${x.titre} »${x.service ? ` (service : ${x.service})` : ''} → métier lu : ${x.ajoutes.map(lu).join(', ')}`).join('\n');
  const r = await repondre(JUGE_MESURE, consigne, o.echantillon, 20, rendu, SCHEMA);
  o.echantillon.forEach((x: any, n: number) => { x.verdictModele = r[n]?.verdict ?? null; });
  o.jugeModele = JUGE_MESURE;
  writeFileSync(FICHIER, JSON.stringify(o, null, 1));
  console.log('verdicts du modèle :', o.echantillon.filter((x: any) => x.verdictModele).length, '/', o.echantillon.length);
}

if (mode === '--compter') {
  const o = JSON.parse(readFileSync(FICHIER, 'utf8'));
  if (o.empreinteManifeste !== empreinte()) throw new Error('le manifeste a changé depuis le tirage');
  const wilson = (f: number, n: number) => { const z = 1.96, p = f / n; return Math.round(1000 * ((p + z * z / (2 * n) + z * Math.sqrt(p * (1 - p) / n + z * z / (4 * n * n))) / (1 + z * z / n))) / 10; };
  const mesure = (cle: string) => {
    const l = o.echantillon.filter((x: any) => x[cle]);
    const n = (v: string) => l.filter((x: any) => x[cle] === v).length;
    return { juges: l.length, C: n('C'), P: n('P'), F: n('F'), fauxOffresPct: Math.round(1000 * n('F') / l.length) / 10, borneHauteWilson95: wilson(n('F'), l.length) };
  };
  o.bilan = { assistant: mesure('verdictAssistant'), modele: mesure('verdictModele') };
  writeFileSync(FICHIER, JSON.stringify(o, null, 1));
  console.log(JSON.stringify(o.bilan, null, 1));
}
