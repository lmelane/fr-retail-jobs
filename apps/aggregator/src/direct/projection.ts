import { createHash } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { storedAmount } from '@catwalks/db/money';
import { detectLanguage } from '../lib/language.js';
import type { OffreCatalogueV1 } from './contrat.js';
import { CORRESPONDANCE_DIRECTE_VERSION, codesSecteur, dimensionsEmploi, employeurAffiche, libellesUnivers } from './vocabulaire.js';

/**
 * LA PROJECTION D'UNE OFFRE DIRECTE DANS LE CATALOGUE (lot 6).
 *
 * Le contrat reçu est conservé tel quel (`payload`, haché) : c'est la
 * provenance. Les colonnes projetées servent la recherche commune et la fiche
 * avec le même vocabulaire que les offres agrégées ; elles sont reconstruites
 * à chaque version, jamais éditées.
 */
export function hashPayload(offre: OffreCatalogueV1): string {
  return createHash('sha256').update(JSON.stringify(offre)).digest('hex');
}

/**
 * Le texte indexé : intitulé, employeur affiché (D-455 §1), métier, univers, lieu et description, dans cet ordre.
 * L'univers y est un mot de secteur de l'offre, sur sa propre ligne, jamais l'employeur. La recherche de l'API ne lit
 * PAS encore ce texte : le document de recherche d'une offre directe l'ignore (`search-model.ts`, génération `search-3`).
 * Sa lecture (génération `search-4` et migration) est mise de côté pour partir avec l'activation des offres directes
 * (D-444) ; voir docs/architecture/recherche-marche.md.
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
export function projeterOffreDirecte(offre: OffreCatalogueV1, seq: bigint, version: bigint) {
  return {
    id: offre.id,
    version,
    appliedSeq: seq,
    eligible: true,
    payloadHash: hashPayload(offre),
    payload: offre as unknown as Prisma.InputJsonValue,
    ...colonnesProjetees(offre),
  };
}

/**
 * Les colonnes que la correspondance DÉRIVE du contrat reçu, et elles seules : ni l'identité, ni l'état (version,
 * séquence, éligibilité), ni la provenance (contrat, hachage). C'est ce que la re-projection du stock reconstruit
 * quand la correspondance change (`reprojeterStock`, feed.ts).
 */
export function colonnesProjetees(offre: OffreCatalogueV1) {
  const emploi = dimensionsEmploi(offre.contrat, offre.tempsDeTravail, offre.teletravail);
  const description = descriptionServie(offre);
  const salaire = offre.salaire;
  return {
    correspondanceVersion: CORRESPONDANCE_DIRECTE_VERSION,
    slug: offre.slug,
    anciensSlugs: offre.anciensSlugs,
    title: offre.titre,
    // D-455 §1 : la Maison publique, sinon « Catwalks » ; jamais l'univers ni « Maison confidentielle ».
    company: employeurAffiche(offre.maison),
    maisonSlug: offre.maison?.slug ?? null,
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
}
