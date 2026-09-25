import { createHash } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { storedAmount } from '@catwalks/db/money';
import { detectLanguage } from '../lib/language.js';
import type { VerdictPays } from '../geo/frontieres.js';
import { lireOffre, type OffreCatalogueV1 } from './contrat.js';
import type { ContexteProjection } from './contexte.js';
import { lireItemListe, offreCatalogueDepuisListe } from './liste.js';
import { CORRESPONDANCE_DIRECTE_VERSION, codesSecteur, dimensionsEmploi, employeurAffiche, libellesUnivers } from './vocabulaire.js';

/**
 * LA PROJECTION D'UNE OFFRE DIRECTE DANS LE CATALOGUE (lot 6 ; D-444).
 *
 * Le contrat reçu est conservé tel quel (`payload`, haché) : c'est la
 * provenance. Les colonnes projetées servent la recherche commune et la fiche
 * avec le même vocabulaire que les offres agrégées ; elles sont reconstruites
 * à chaque version, jamais éditées. Leur empreinte (`projectionHash`) permet au
 * lecteur de la liste publique de n'écrire que ce qui change (`photo.ts`).
 */
export function hashPayload(offre: OffreCatalogueV1): string {
  return createHash('sha256').update(JSON.stringify(offre)).digest('hex');
}

const canonique = (valeur: unknown): unknown => {
  if (valeur instanceof Date) return valeur.toISOString();
  if (Prisma.Decimal.isDecimal(valeur)) return (valeur as Prisma.Decimal).toString();
  if (Array.isArray(valeur)) return valeur.map(canonique);
  if (valeur && typeof valeur === 'object')
    return Object.fromEntries(Object.keys(valeur).sort().map((cle) => [cle, canonique((valeur as Record<string, unknown>)[cle])]));
  return valeur;
};
/** L'empreinte d'une valeur JSON indépendante de l'ordre des clés : un même contenu, une même empreinte. */
export function empreinteStable(valeur: unknown): string {
  return createHash('sha256').update(JSON.stringify(canonique(valeur))).digest('hex');
}

/**
 * Le texte indexé : intitulé, employeur affiché (D-455 §1), métier, univers, lieu et description, dans cet ordre.
 * L'univers y est un mot de secteur de l'offre, sur sa propre ligne, jamais l'employeur. La génération de recherche
 * `search-4` le verse au document d'une offre directe (`apps/api/lib/search-model.ts`).
 */
export function texteRecherche(offre: OffreCatalogueV1): string {
  return [
    offre.titre, employeurAffiche(offre.maison), offre.metier?.libelle ?? '', libellesUnivers(offre.univers).join(', '), offre.lieu.libelle,
    offre.lieu.ville ?? '', offre.lieu.codePostal ?? '', offre.description.poste, offre.description.missions, offre.description.profil,
  ].filter(Boolean).join('\n');
}

/** La description servie : les sections rédactionnelles, séparées, dans l'ordre de la fiche Catwalks. */
export function descriptionServie(offre: OffreCatalogueV1): string {
  return [offre.description.marque, offre.description.poste, offre.description.missions, offre.description.profil, offre.description.avantages]
    .filter((s): s is string => Boolean(s && s.trim()))
    .join('\n\n');
}

/** Une offre publiée : son identité, son état et sa provenance, puis les colonnes que la correspondance en dérive. */
export function projeterOffreDirecte(offre: OffreCatalogueV1, seq: bigint, version: bigint, contexte: ContexteProjection) {
  return {
    id: offre.id,
    version,
    appliedSeq: seq,
    eligible: true,
    payloadHash: hashPayload(offre),
    payload: offre as unknown as Prisma.InputJsonValue,
    ...colonnesProjetees(offre, contexte),
  };
}

/**
 * Les colonnes que la correspondance DÉRIVE du contrat reçu et du contexte (registre, taxonomie), et elles seules : ni
 * l'identité, ni l'état (version, séquence, éligibilité), ni la provenance (contrat, hachage). C'est ce que la
 * re-projection du stock reconstruit quand la correspondance change (`reprojeterStock`, reprojection.ts), avec leur
 * empreinte.
 */
export function colonnesProjetees(offre: OffreCatalogueV1, contexte: ContexteProjection) {
  const emploi = dimensionsEmploi(offre.contrat, offre.tempsDeTravail, offre.teletravail);
  const description = descriptionServie(offre);
  const salaire = offre.salaire;
  const metier = contexte.metier(offre.titre);
  const colonnes = {
    correspondanceVersion: CORRESPONDANCE_DIRECTE_VERSION,
    slug: offre.slug,
    anciensSlugs: offre.anciensSlugs,
    title: offre.titre,
    // D-455 §1 : la Maison publique, sinon « Catwalks » ; jamais l'univers ni « Maison confidentielle ».
    company: employeurAffiche(offre.maison),
    maisonSlug: offre.maison?.slug ?? null,
    // D-444 : la Maison publique rattachée au registre (son groupe sert le filtre « groupe ») ; un mandat, jamais.
    companyId: contexte.rattacher(offre.maison?.nom),
    countryCode: offre.lieu.pays,
    city: offre.lieu.ville,
    postalCode: offre.lieu.codePostal,
    location: offre.lieu.libelle,
    latitude: offre.lieu.latitude,
    longitude: offre.lieu.longitude,
    employmentTerm: emploi.employmentTerm,
    workTime: emploi.workTime,
    programType: emploi.programType,
    engagementType: emploi.engagementType,
    workplaceType: emploi.workplaceType,
    sectorCodes: codesSecteur(offre.univers, offre.specialisations),
    // D-444 : le métier de la taxonomie active, appliquée à l'intitulé (filtre « métier ») ; le libellé du backend reste affiché.
    occupationCode: metier.occupationCode,
    occupationReleaseId: metier.occupationReleaseId,
    occupationLabel: offre.metier?.libelle ?? null,
    language: detectLanguage(`${offre.titre}\n${description}`) ?? null,
    description,
    // Le backend publie des bornes annuelles brutes entières ; la devise n'est servie qu'avec une borne.
    salaryMin: storedAmount(salaire.min),
    salaryMax: storedAmount(salaire.max),
    salaryCurrency: salaire.min !== null || salaire.max !== null ? salaire.devise : null,
    salaryPeriod: salaire.min !== null || salaire.max !== null ? 'YEAR' : null,
    visuel: offre.visuel,
    applyUrl: offre.candidature.url,
    postedAt: new Date(offre.publieeLe),
    validThrough: offre.finLe ? new Date(offre.finLe) : null,
    modifiedAt: new Date(offre.modifieeLe),
    searchText: texteRecherche(offre),
  };
  return { ...colonnes, projectionHash: empreinteStable(colonnes) };
}

/** Le contrat conservé d'une ligne, relu : un contrat du flux (`titre`) tel quel, ou une offre de la liste publique
 * (`title`) dont le pays est recalculé depuis ses coordonnées, avec le verdict qui l'établit. */
export type OffreRelue = { offre: OffreCatalogueV1; pays: VerdictPays | null };
export function relirePayload(payload: unknown, contexte: ContexteProjection): OffreRelue {
  if (payload && typeof payload === 'object' && !Array.isArray(payload) && 'titre' in payload) return { offre: lireOffre(payload), pays: null };
  const item = lireItemListe(payload, 'payload');
  const pays = contexte.pays(item.latitude, item.longitude);
  return { offre: offreCatalogueDepuisListe(item, pays.pays), pays };
}
