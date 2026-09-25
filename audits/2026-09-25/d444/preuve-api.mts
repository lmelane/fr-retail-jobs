/**
 * D-444 / R-126 — PREUVE PAR L'API LOCALE, branchée sur la base jetable de `preuve-base-jetable.mts`.
 *
 * Pour chaque recherche France (sans filtre ; secteur, contrat, métier, groupe ; mot-clé), toutes les pages sont lues en
 * suivant `suivant`, comme le site : aucune offre Catwalks ne doit apparaître après une offre agrégée, aucune offre deux
 * fois, et la page 2 prolonge la page 1. Lecture HTTP seule.
 *
 * Usage : npx tsx audits/2026-09-25/d444/preuve-api.mts --api=http://127.0.0.1:<port> --sortie=<fichier JSON>
 */
import { writeFileSync } from 'node:fs';
import { parseArgs } from 'node:util';

const { values } = parseArgs({ options: { api: { type: 'string' }, sortie: { type: 'string' } } });
const api = new URL(values.api ?? '');
if (!['127.0.0.1', 'localhost'].includes(api.hostname)) throw new Error('REFUS : API locale seulement');
if (!values.sortie) throw new Error('--sortie requis');

type Ligne = { id: string; origine: 'CATWALKS' | 'AGREGEE'; company: string; title: string; countryCode: string | null; postedAt: string | null };
type Reponse = { jobs: Ligne[]; total: number; suivant: string | null; filtresRefuses: unknown[] };

async function lire(parametres: Record<string, string>, apres?: string): Promise<Reponse> {
  const url = new URL('/api/jobs', api);
  for (const [cle, valeur] of Object.entries(parametres)) url.searchParams.set(cle, valeur);
  if (apres) url.searchParams.set('apres', apres);
  const reponse = await fetch(url, { signal: AbortSignal.timeout(60_000) });
  if (!reponse.ok) throw new Error(`${url.search} : HTTP ${reponse.status} ${await reponse.text()}`);
  return reponse.json() as Promise<Reponse>;
}

const CAS: [string, Record<string, string>][] = [
  ['sans filtre', { marche: 'FR' }],
  ['secteur Mode (FASHION)', { marche: 'FR', secteur: 'FASHION' }],
  ['secteur Beauté (BEAUTY)', { marche: 'FR', secteur: 'BEAUTY' }],
  ['contrat CDI (PERMANENT)', { marche: 'FR', contrat: 'PERMANENT' }],
  ['métier conseiller de vente (sales-advisor)', { marche: 'FR', metier: 'sales-advisor' }],
  ['groupe LVMH', { marche: 'FR', groupe: 'LVMH' }],
  ['mot-clé « conseiller », visiteur en France', { marche: 'FR', q: 'conseiller', prioritePays: 'FR' }],
  ['mot-clé « parfum »', { marche: 'FR', q: 'parfum' }],
  ['mot-clé « luxe »', { marche: 'FR', q: 'luxe' }],
  ['mot-clé de métier « conseiller de vente »', { marche: 'FR', q: 'conseiller de vente' }],
  ['mot-clé de métier « vendeur »', { marche: 'FR', q: 'vendeur' }],
  ['mot-clé de métier « vendeuse »', { marche: 'FR', q: 'vendeuse' }],
  ['mot-clé de métier « conseillère de vente »', { marche: 'FR', q: 'conseillère de vente' }],
  ['mot-clé de groupe « LVMH »', { marche: 'FR', q: 'LVMH' }],
];

const resultats = [];
for (const [nom, parametres] of CAS) {
  const pages: Ligne[][] = [];
  let apres: string | undefined, total = 0, refus: unknown[] = [];
  do {
    const r = await lire(parametres, apres);
    pages.push(r.jobs);
    total = r.total; refus = r.filtresRefuses;
    apres = r.suivant ?? undefined;
  } while (apres && pages.length < 10);
  const toutes = pages.flat();
  const ids = toutes.map((l) => l.id);
  const premiereAgregee = toutes.findIndex((l) => l.origine === 'AGREGEE');
  const derniereCatwalks = toutes.map((l) => l.origine).lastIndexOf('CATWALKS');
  const catwalks = toutes.filter((l) => l.origine === 'CATWALKS').length;
  resultats.push({
    cas: nom, parametres, total, filtresRefuses: refus, pages: pages.length, lues: toutes.length,
    catwalks, agregees: toutes.length - catwalks,
    page1: { catwalks: pages[0].filter((l) => l.origine === 'CATWALKS').length, agregees: pages[0].filter((l) => l.origine === 'AGREGEE').length },
    page2: pages[1] ? { catwalks: pages[1].filter((l) => l.origine === 'CATWALKS').length, agregees: pages[1].filter((l) => l.origine === 'AGREGEE').length } : null,
    premiereAgregee, derniereCatwalks,
    catwalksDabord: premiereAgregee === -1 || derniereCatwalks < premiereAgregee,
    sansDoublon: new Set(ids).size === ids.length,
    tousLesResultatsLus: toutes.length === total,
    premieres: toutes.slice(0, 3).map((l) => `${l.origine} · ${l.company} · ${l.title}`),
    premiereAgregeeVue: premiereAgregee >= 0 ? `${toutes[premiereAgregee].company} · ${toutes[premiereAgregee].title} · ${toutes[premiereAgregee].postedAt}` : null,
  });
  console.log(JSON.stringify(resultats.at(-1)));
}
// La facette « Maison » ne doit pas proposer deux orthographes d'une même Maison (casse, accents, apostrophes).
const cle = (nom: string) => nom.normalize('NFKD').replace(/\p{M}/gu, '').replace(/[’‘`´ʼ]/gu, "'").replace(/\s+/g, ' ').trim().toLowerCase();
const facette = ((await (await fetch(new URL('/api/jobs?marche=FR', api))).json()) as { facettes: { cle: string; options: { value: string }[] }[] })
  .facettes.find((f) => f.cle === 'maison')?.options ?? [];
const groupes = new Map<string, string[]>();
for (const o of facette) groupes.set(cle(o.value), [...(groupes.get(cle(o.value)) ?? []), o.value]);
const maisonsEnDouble = [...groupes.values()].filter((v) => v.length > 1);
console.log(JSON.stringify({ optionsMaison: facette.length, maisonsEnDouble }));

// Chaque nom de Maison qu'affiche une carte Catwalks (le nom publié par le backend) retrouve, en lien `?maison=`, toutes
// les offres Catwalks de ce nom : l'annuaire, le bloc Maison et la fiche fermée bâtissent leurs liens sur lui.
async function toutesLesLignes(parametres: Record<string, string>): Promise<Ligne[]> {
  const lignes: Ligne[] = [];
  let apres: string | undefined;
  do {
    const r = await lire(parametres, apres);
    lignes.push(...r.jobs);
    apres = r.suivant ?? undefined;
  } while (apres);
  return lignes;
}
const catwalksFR = (await toutesLesLignes({ marche: 'FR' })).filter((l) => l.origine === 'CATWALKS');
const nomsAffiches = [...new Set(catwalksFR.map((l) => l.company))].sort();
const liensMorts = [];
for (const nom of nomsAffiches) {
  const attendues = catwalksFR.filter((l) => l.company === nom).map((l) => l.id);
  const trouvees = new Set((await toutesLesLignes({ marche: 'FR', maison: nom })).map((l) => l.id));
  const manquantes = attendues.filter((id) => !trouvees.has(id));
  if (manquantes.length) liensMorts.push({ nom, manquantes });
}
console.log(JSON.stringify({ nomsAffiches: nomsAffiches.length, liensMorts }));
// L'annuaire : une ligne par Maison, jamais deux orthographes de la même.
type Societe = { id: string; name: string; jobCount: number };
const annuaire: Societe[] = [];
let suite: string | null = null;
do {
  const url = new URL('/api/companies', api);
  url.searchParams.set('marche', 'FR');
  if (suite) url.searchParams.set('apres', suite);
  const r = (await (await fetch(url, { signal: AbortSignal.timeout(60_000) })).json()) as { companies: Societe[]; suivant: string | null };
  annuaire.push(...r.companies);
  suite = r.suivant;
} while (suite && annuaire.length < 5_000);
const lignesAnnuaire = new Map<string, string[]>();
for (const s of annuaire) lignesAnnuaire.set(cle(s.name), [...(lignesAnnuaire.get(cle(s.name)) ?? []), s.name]);
const annuaireEnDouble = [...lignesAnnuaire.values()].filter((v) => v.length > 1);
console.log(JSON.stringify({ lignesAnnuaire: annuaire.length, annuaireEnDouble }));

const ok = resultats.every((r) => r.catwalksDabord && r.sansDoublon && r.tousLesResultatsLus && r.catwalks > 0) && maisonsEnDouble.length === 0
  && liensMorts.length === 0 && annuaireEnDouble.length === 0;
writeFileSync(values.sortie, JSON.stringify({ mesureLe: new Date().toISOString(), api: api.origin, ok, resultats,
  facetteMaison: { options: facette.length, maisonsEnDouble }, liensMaison: { nomsAffiches: nomsAffiches.length, liensMorts },
  annuaire: { lignes: annuaire.length, enDouble: annuaireEnDouble } }, null, 2) + '\n');
console.log(JSON.stringify({ ok }));
process.exitCode = ok ? 0 : 1;
