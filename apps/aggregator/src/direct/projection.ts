import { createHash } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { storedAmount } from '@catwalks/db/money';
import { detectLanguage } from '../lib/language.js';
import type { OffreCatalogueV1 } from './contrat.js';
import { CORRESPONDANCE_DIRECTE_VERSION, codesSecteur, dimensionsEmploi, nomUnivers } from './vocabulaire.js';

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

/** Le texte indexé : intitulé, Maison, métier, lieu et description, dans cet ordre. */
export function texteRecherche(offre: OffreCatalogueV1): string {
  return [
    offre.titre, offre.maison?.nom ?? nomUnivers(offre.univers), offre.metier?.libelle ?? '', offre.lieu.libelle,
    offre.lieu.ville ?? '', offre.lieu.codePostal ?? '', offre.description.poste, offre.description.missions, offre.description.profil,
  ].filter(Boolean).join('\n');
}

/** La description servie : les sections rédactionnelles, séparées, dans l'ordre de la fiche Catwalks. */
export function descriptionServie(offre: OffreCatalogueV1): string {
  return [offre.description.marque, offre.description.poste, offre.description.missions, offre.description.profil, offre.description.avantages]
    .filter((s): s is string => Boolean(s && s.trim()))
    .join('\n\n');
}

export function projeterOffreDirecte(offre: OffreCatalogueV1, seq: bigint, version: bigint) {
  const emploi = dimensionsEmploi(offre.contrat, offre.tempsDeTravail, offre.teletravail);
  const description = descriptionServie(offre);
  const salaire = offre.salaire;
  return {
    id: offre.id,
    version,
    appliedSeq: seq,
    eligible: true,
    payloadHash: hashPayload(offre),
    payload: offre as unknown as Prisma.InputJsonValue,
    correspondanceVersion: CORRESPONDANCE_DIRECTE_VERSION,
    slug: offre.slug,
    anciensSlugs: offre.anciensSlugs,
    title: offre.titre,
    company: offre.maison?.nom ?? nomUnivers(offre.univers),
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
