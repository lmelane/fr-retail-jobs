/**
 * LE CONTRAT PUBLIC D'UNE OFFRE DIRECTE, TEL QUE L'AGRÉGATEUR LE LIT (lot 6, D-423).
 *
 * Miroir strict de `catwalks-backend/src/lib/catalogue-public.ts`, version 1.
 * Ce module ne fait confiance à rien : chaque événement du flux est relu
 * champ par champ, et la première divergence de forme refuse l'événement avec
 * son chemin. Une version de contrat inconnue refuse tout le flux — mieux vaut
 * ne rien projeter que projeter de travers.
 *
 * Les grands entiers (séquence, version) arrivent en chaînes et deviennent des
 * `bigint` ici ; ils ne passent jamais par un `number`.
 */
export const CATALOGUE_CONTRAT_VERSION = 1;

export type LieuCatalogue = {
  libelle: string;
  ville: string | null;
  arrondissement: string | null;
  codePostal: string | null;
  pays: string | null;
  latitude: number | null;
  longitude: number | null;
};

export type OffreCatalogueV1 = {
  version: 1;
  id: string;
  slug: string;
  anciensSlugs: string[];
  titre: string;
  maison: { nom: string; slug: string } | null;
  univers: string[];
  specialisations: string[];
  metier: { slug: string; libelle: string } | null;
  contrat: string;
  tempsDeTravail: string;
  experience: string | null;
  teletravail: string | null;
  lieu: LieuCatalogue;
  salaire: { min: number | null; max: number | null; devise: string | null; texte: string | null };
  description: { marque: string | null; poste: string; missions: string; profil: string; avantages: string | null };
  visuel: string | null;
  publieeLe: string;
  finLe: string | null;
  modifieeLe: string;
  candidature: { type: 'CATWALKS'; url: string };
};

export type EvenementCatalogue =
  | { seq: bigint; version: bigint; evenement: 'PUBLIE'; offre: OffreCatalogueV1 }
  | { seq: bigint; version: bigint; evenement: 'RETIRE'; offreId: string };

export type FluxCatalogue = { version: number; evenements: EvenementCatalogue[]; suivant: bigint | null };

export class ContratInvalideError extends Error {
  constructor(readonly chemin: string, detail: string) {
    super(`Contrat catalogue invalide à ${chemin} : ${detail}`);
    this.name = 'ContratInvalideError';
  }
}

type Brut = Record<string, unknown>;
const objet = (v: unknown, chemin: string): Brut => {
  if (!v || typeof v !== 'object' || Array.isArray(v)) throw new ContratInvalideError(chemin, 'objet attendu');
  return v as Brut;
};
const texte = (v: unknown, chemin: string, max = 20_000): string => {
  if (typeof v !== 'string' || v.length > max) throw new ContratInvalideError(chemin, `chaîne attendue (≤ ${max})`);
  return v;
};
const texteOuNull = (v: unknown, chemin: string, max = 20_000): string | null => (v === null ? null : texte(v, chemin, max));
const nombreOuNull = (v: unknown, chemin: string): number | null => {
  if (v === null) return null;
  if (typeof v !== 'number' || !Number.isFinite(v)) throw new ContratInvalideError(chemin, 'nombre attendu');
  return v;
};
const grandEntier = (v: unknown, chemin: string): bigint => {
  if (typeof v !== 'string' || !/^\d{1,19}$/.test(v)) throw new ContratInvalideError(chemin, 'entier en chaîne attendu');
  return BigInt(v);
};
const liste = (v: unknown, chemin: string): string[] => {
  if (!Array.isArray(v) || v.length > 50) throw new ContratInvalideError(chemin, 'liste de chaînes attendue');
  return v.map((x, i) => texte(x, `${chemin}[${i}]`, 200));
};
const dateIso = (v: unknown, chemin: string): string => {
  const s = texte(v, chemin, 40);
  if (Number.isNaN(Date.parse(s))) throw new ContratInvalideError(chemin, 'date ISO attendue');
  return s;
};
const identifiant = (v: unknown, chemin: string): string => {
  const s = texte(v, chemin, 200);
  if (!/^[A-Za-z0-9_-]+$/.test(s)) throw new ContratInvalideError(chemin, 'identifiant attendu');
  return s;
};

export function lireOffre(v: unknown, chemin = 'offre'): OffreCatalogueV1 {
  const o = objet(v, chemin);
  if (o.version !== CATALOGUE_CONTRAT_VERSION) throw new ContratInvalideError(`${chemin}.version`, `version ${String(o.version)} non lue`);
  const maison = o.maison === null ? null : objet(o.maison, `${chemin}.maison`);
  const metier = o.metier === null ? null : objet(o.metier, `${chemin}.metier`);
  const lieu = objet(o.lieu, `${chemin}.lieu`);
  const salaire = objet(o.salaire, `${chemin}.salaire`);
  const description = objet(o.description, `${chemin}.description`);
  const candidature = objet(o.candidature, `${chemin}.candidature`);
  const pays = texteOuNull(lieu.pays, `${chemin}.lieu.pays`, 2);
  if (pays !== null && !/^[A-Z]{2}$/.test(pays)) throw new ContratInvalideError(`${chemin}.lieu.pays`, 'code ISO-2 attendu');
  if (candidature.type !== 'CATWALKS') throw new ContratInvalideError(`${chemin}.candidature.type`, 'CATWALKS attendu');
  const url = texte(candidature.url, `${chemin}.candidature.url`, 2_000);
  let u: URL;
  try { u = new URL(url); } catch { throw new ContratInvalideError(`${chemin}.candidature.url`, 'URL attendue'); }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') throw new ContratInvalideError(`${chemin}.candidature.url`, 'http(s) attendu');
  return {
    version: 1,
    id: identifiant(o.id, `${chemin}.id`),
    slug: identifiant(o.slug, `${chemin}.slug`),
    anciensSlugs: liste(o.anciensSlugs, `${chemin}.anciensSlugs`),
    titre: texte(o.titre, `${chemin}.titre`, 500),
    maison: maison && { nom: texte(maison.nom, `${chemin}.maison.nom`, 200), slug: identifiant(maison.slug, `${chemin}.maison.slug`) },
    univers: liste(o.univers, `${chemin}.univers`),
    specialisations: liste(o.specialisations, `${chemin}.specialisations`),
    metier: metier && { slug: identifiant(metier.slug, `${chemin}.metier.slug`), libelle: texte(metier.libelle, `${chemin}.metier.libelle`, 200) },
    contrat: texte(o.contrat, `${chemin}.contrat`, 50),
    tempsDeTravail: texte(o.tempsDeTravail, `${chemin}.tempsDeTravail`, 50),
    experience: texteOuNull(o.experience, `${chemin}.experience`, 50),
    teletravail: texteOuNull(o.teletravail, `${chemin}.teletravail`, 50),
    lieu: {
      libelle: texte(lieu.libelle, `${chemin}.lieu.libelle`, 500),
      ville: texteOuNull(lieu.ville, `${chemin}.lieu.ville`, 200),
      arrondissement: texteOuNull(lieu.arrondissement, `${chemin}.lieu.arrondissement`, 20),
      codePostal: texteOuNull(lieu.codePostal, `${chemin}.lieu.codePostal`, 20),
      pays,
      latitude: nombreOuNull(lieu.latitude, `${chemin}.lieu.latitude`),
      longitude: nombreOuNull(lieu.longitude, `${chemin}.lieu.longitude`),
    },
    salaire: {
      min: nombreOuNull(salaire.min, `${chemin}.salaire.min`),
      max: nombreOuNull(salaire.max, `${chemin}.salaire.max`),
      devise: texteOuNull(salaire.devise, `${chemin}.salaire.devise`, 10),
      texte: texteOuNull(salaire.texte, `${chemin}.salaire.texte`, 200),
    },
    description: {
      marque: texteOuNull(description.marque, `${chemin}.description.marque`),
      poste: texte(description.poste, `${chemin}.description.poste`),
      missions: texte(description.missions, `${chemin}.description.missions`),
      profil: texte(description.profil, `${chemin}.description.profil`),
      avantages: texteOuNull(description.avantages, `${chemin}.description.avantages`),
    },
    visuel: texteOuNull(o.visuel, `${chemin}.visuel`, 2_000),
    publieeLe: dateIso(o.publieeLe, `${chemin}.publieeLe`),
    finLe: o.finLe === null ? null : dateIso(o.finLe, `${chemin}.finLe`),
    modifieeLe: dateIso(o.modifieeLe, `${chemin}.modifieeLe`),
    candidature: { type: 'CATWALKS', url: u.toString() },
  };
}

export function lireEvenement(v: unknown, chemin = 'evenement'): EvenementCatalogue {
  const e = objet(v, chemin);
  const seq = grandEntier(e.seq, `${chemin}.seq`);
  const version = grandEntier(e.version, `${chemin}.version`);
  if (e.evenement === 'PUBLIE') return { seq, version, evenement: 'PUBLIE', offre: lireOffre(e.offre, `${chemin}.offre`) };
  if (e.evenement === 'RETIRE') return { seq, version, evenement: 'RETIRE', offreId: identifiant(e.offreId, `${chemin}.offreId`) };
  throw new ContratInvalideError(`${chemin}.evenement`, 'PUBLIE ou RETIRE attendu');
}

/** Une page du flux : version de contrat vérifiée, événements en ordre de séquence strictement croissant. */
export function lireFlux(v: unknown): FluxCatalogue {
  const f = objet(v, 'flux');
  if (f.version !== CATALOGUE_CONTRAT_VERSION) throw new ContratInvalideError('flux.version', `version ${String(f.version)} non lue`);
  if (!Array.isArray(f.evenements) || f.evenements.length > 1_000) throw new ContratInvalideError('flux.evenements', 'liste attendue');
  const evenements = f.evenements.map((e, i) => lireEvenement(e, `flux.evenements[${i}]`));
  for (let i = 1; i < evenements.length; i++) {
    if (evenements[i].seq <= evenements[i - 1].seq) throw new ContratInvalideError(`flux.evenements[${i}].seq`, 'séquence non croissante');
  }
  const suivant = f.suivant === null ? null : grandEntier(f.suivant, 'flux.suivant');
  if (suivant !== null && evenements.length && suivant !== evenements[evenements.length - 1].seq) {
    throw new ContratInvalideError('flux.suivant', 'doit être la dernière séquence servie');
  }
  return { version: CATALOGUE_CONTRAT_VERSION, evenements, suivant };
}
