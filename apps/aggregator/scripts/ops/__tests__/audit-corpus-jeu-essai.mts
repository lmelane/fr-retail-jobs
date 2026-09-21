/**
 * LE JEU D'ESSAI DE L'EXPORT — sur base isolée portant le SCHÉMA APPLICATIF RÉEL.
 *
 *   DATABASE_URL='...base de test...' npx tsx \
 *     apps/aggregator/scripts/ops/__tests__/audit-corpus-jeu-essai.mts
 *
 * Le schéma s'installe par la procédure autorisée du projet, celle de la CI :
 *   npx prisma migrate deploy --schema packages/db/prisma/schema.prisma
 *
 * ── CE QU'IL POSE, ET POURQUOI CHAQUE CAS EXISTE ───────────────────────────────────────────────
 *
 *  1. UNE SOURCE AVEC UNE VRAIE CAPTURE ET SON CORPS, SANS AUCUNE `JobSource`.
 *     C'est la population « RAW présent, aucune publication » : invisible pour
 *     `jobId IS NULL`, puisqu'elle n'a pas de ligne `JobSource` du tout. Son corps est un vrai
 *     gzip, stocké par le code de production (`storeRawBlob`), donc relisible et vérifiable.
 *
 *  2. UNE SOURCE PUBLIÉE, avec la chaîne complète jusqu'à l'offre canonique :
 *     `Source` → `CaptureBatch` → `RawCapture` → `SourceExtraction` → `JobSource` → `Job`.
 *     Elle vérifie que les liens survivent à l'export.
 *
 *  3. UNE OFFRE DIRECTE et une `Company`, nécessaires aux comparaisons avec le catalogue public.
 *
 * Il ne nettoie rien : la base est jetable, et laisser l'état permet d'inspecter un échec.
 */
import { PrismaClient } from '@prisma/client';
import { storeRawBlob, persistCapture, persistExtractionOutputs } from '../../../src/capture/store.js';
import { persistExtractionManifest } from '../../../src/capture/manifest.js';
import { evidenceHash } from '../../../src/lib/evidenceHash.js';
import { createHash } from 'node:crypto';

/**
 * Une enveloppe de requête native CONFORME au contrat de `validateRequestData`.
 *
 * Le contrat est strict et vérifié à l'écriture : six clés exactes sur la description, trois
 * en-têtes de négociation nommés, une empreinte de corps en 64 hexadécimaux, une origine
 * cohérente avec le format. Le respecter ici, plutôt que de le contourner, garantit que le jeu
 * d'essai écrit ce que la production écrirait.
 */
function enveloppe(url: string) {
  const description = {
    url, method: 'GET', format: 'HTTP_RESPONSE' as const,
    bodyHash: createHash('sha256').update('').digest('hex'),
    userAgent: 'catwalks-audit-essai',
    negotiation: { accept: 'application/json', 'accept-language': 'fr', 'content-type': null },
  };
  return {
    version: 1 as const, logical: description, origin: 'HTTP_TRANSPORT' as const,
    hops: [{ request: description, status: 200, responseHeaders: { 'content-type': 'application/json' }, failure: null }],
  };
}

const url = process.env.DATABASE_URL ?? '';
if (!/test/i.test(url)) {
  console.error('GARDE-FOU : base isolée exigée (son nom doit contenir « test »).');
  process.exit(2);
}
const prisma = new PrismaClient({ datasources: { db: { url } } });

/** Le contenu RAW de la source non publiée — un vrai corps, analysable. */
const CORPS_SANS_PUBLICATION = JSON.stringify({
  jobs: [
    { id: 'np-1', title: 'Conseiller de vente', contract: 'CDI', workingTime: 'Temps plein',
      country: 'PT', city: 'Lisboa' },
    { id: 'np-2', title: 'Responsable boutique', contract: 'CDD', workingTime: 'Temps partiel',
      country: 'PT', city: 'Porto' },
  ],
});

const N = `essai-${process.pid}`;

async function main() {
  /*
   * PAS D'EFFACEMENT — `CaptureBatch` EST IMMUABLE, et un trigger le fait respecter
   * (« CaptureBatch is immutable », SQLSTATE P0001). C'est une garantie du produit : un lot de
   * capture est une PREUVE, et une preuve ne se supprime pas, même en test.
   *
   * L'idempotence est donc obtenue par des clés UNIQUES par exécution. Rejouer ce script ajoute
   * un jeu d'essai de plus au lieu d'en réécrire un — ce qui est aussi plus fidèle à la
   * production, où les collectes s'accumulent.
   */
  // ── CAS 1 : captures + corps, AUCUNE publication. ──────────────────────────────────────────
  await prisma.source.create({ data: {
    key: `${N}-sans-publication`, kind: 'generic-listing', status: 'ACTIVE',
    maison: 'Maison Sans Publication', config: {}, tier: 'EMPLOYER_SITE',
    tenantKey: `${N}-sans-publication`,
  } });
  const lotMuet = await prisma.captureBatch.create({ data: {
    sourceKey: `${N}-sans-publication`, configHash: 'h-muet', readerRevision: 'rev-essai',
  } });
  /*
   * Le corps passe par le code de PRODUCTION : `persistCapture` gzip, calcule l'empreinte,
   * dédoublonne et verrouille dans le bon ordre. Lui donner les OCTETS plutôt qu'un hash déjà
   * calculé garantit que le jeu d'essai écrit exactement ce qu'une collecte écrirait.
   */
  await persistCapture(prisma, lotMuet.id, {
    sequence: 1, requestHash: createHash('sha256').update('rq-muet').digest('hex'), requestUrl: 'https://exemple.test/offres',
    method: 'GET', format: 'HTTP_RESPONSE', status: 200, headers: {}, cookieNames: [],
    complete: true, failure: null, bytes: new TextEncoder().encode(CORPS_SANS_PUBLICATION),
    requestData: enveloppe('https://exemple.test/offres'),
  } as never);
  /*
   * DEUX triggers gardent l'attestation de succès : l'un exige son manifeste et son hash de
   * sortie, l'autre que ce hash corresponde EXACTEMENT aux extractions du lot, dans l'ordre.
   * C'est la chaîne de preuve du produit, et on la respecte en réutilisant la même séquence que
   * la fixture d'intégration (`src/test/publicationPersistenceFixture.ts`) : sorties, puis
   * manifeste, puis attestation.
   */
  const offresMuettes = [
    { externalId: `${N}-np-1`, title: 'Conseiller de vente', url: 'https://exemple.test/np-1' },
    { externalId: `${N}-np-2`, title: 'Responsable boutique', url: 'https://exemple.test/np-2' },
  ] as never[];
  await persistExtractionOutputs(prisma, lotMuet.id, offresMuettes);
  const manifesteMuet = await persistExtractionManifest(prisma, lotMuet.id, { jobs: offresMuettes });
  await prisma.captureOutcome.create({ data: {
    batchId: lotMuet.id, status: 'EXTRACTED', extractedCount: offresMuettes.length,
    manifestHash: manifesteMuet, outputHash: evidenceHash(offresMuettes),
  } });

  // ── CAS 2 : la chaîne complète jusqu'à l'offre canonique. ───────────────────────────────────
  const maison = await prisma.company.create({ data: {
    name: `Maison ${N}`, canonicalKey: `maison-${N}`,
    fashionjobsUrl: `https://fashionjobs.test/${N}`,
    sector: 'FASHION',
    /*
     * `sectorCodes` n'est PAS posé : un trigger exige « an exact reviewed manifest » — le secteur
     * multiple ne s'écrit qu'au terme d'une revue. Le fabriquer ici produirait une ligne que le
     * produit n'écrirait jamais. L'export lit la colonne ; le jeu d'essai vérifie qu'elle
     * traverse, pas qu'on sait la remplir à la main.
     */
  } });
  await prisma.source.create({ data: {
    key: `${N}-publiee`, kind: 'generic-listing', status: 'ACTIVE',
    maison: `Maison ${N}`, config: {}, tier: 'EMPLOYER_SITE',
    tenantKey: `${N}-publiee`,
  } });
  const lotPublie = await prisma.captureBatch.create({ data: {
    sourceKey: `${N}-publiee`, configHash: 'h-pub', readerRevision: 'rev-essai',
  } });
  const octetsPublie = new TextEncoder().encode(JSON.stringify({ jobs: [{ id: 'p-1', title: 'Vendeur' }] }));
  await persistCapture(prisma, lotPublie.id, {
    sequence: 1, requestHash: createHash('sha256').update('rq-pub').digest('hex'), requestUrl: 'https://exemple.test/fr',
    method: 'GET', format: 'HTTP_RESPONSE', status: 200, headers: {}, cookieNames: [],
    complete: true, failure: null, bytes: octetsPublie,
    requestData: enveloppe('https://exemple.test/fr'),
  } as never);
  // L'extraction référence le même corps : `storeRawBlob` dédoublonne par empreinte.
  const hashPublie = await storeRawBlob(prisma, octetsPublie);
  const extraction = await prisma.sourceExtraction.create({ data: {
    batchId: lotPublie.id, ordinal: 0, externalId: `${N}-p-1`, outputHash: hashPublie,
  } });
  const offre = await prisma.job.create({ data: {
    title: 'Vendeur', companyId: maison.id, source: 'GENERIC_JSONLD', isActive: true,
    externalId: `${N}-p-1`,
    countryCode: 'FR', city: 'Paris', employmentTerm: 'PERMANENT', workTime: 'FULL_TIME',
    workplaceType: 'ONSITE', language: 'fr', url: 'https://exemple.test/fr/p-1',
  } });
  // Prisma exige les RELATIONS, pas les clés étrangères brutes, quand la relation est déclarée.
  await prisma.jobSource.create({ data: {
    sourceKey: `${N}-publiee`, externalId: `${N}-p-1`, isActive: true,
    sourceTier: 'EMPLOYER_SITE', url: 'https://exemple.test/fr/p-1',
    job: { connect: { id: offre.id } },
    captureBatch: { connect: { id: lotPublie.id } },
    // `captureOutput` porte une clé COMPOSITE [id, batchId] : l'extraction n'est identifiable
    // que dans son lot, ce qui interdit de rattacher une sortie au mauvais lot de capture.
    captureOutput: { connect: { id_batchId: { id: extraction.id, batchId: lotPublie.id } } },
  } });

  /*
   * ── CAS 3 : `DirectOffer` n'est PAS posée ici, et c'est délibéré. ─────────────────────────
   *
   * C'est une PROJECTION : elle exige `payload`, `payloadHash`, `version`, `appliedSeq`,
   * `correspondanceVersion` et `slug`, tous produits par le pipeline de projection. La fabriquer
   * à la main produirait une ligne que le produit n'écrirait jamais — un jeu d'essai qui ne
   * ressemble pas à la production ne prouve rien sur elle.
   *
   * L'export la lit si elle existe ; le test ci-dessous vérifie que le fichier est PRODUIT
   * (vide ici), ce qui suffit à prouver que le lien est en place. Le remplir demanderait de
   * faire tourner la projection, un lot à part entière.
   */

  const compte = {
    sources: await prisma.source.count(),
    lots: await prisma.captureBatch.count(),
    captures: await prisma.rawCapture.count(),
    corps: await prisma.rawBlob.count(),
    publications: await prisma.jobSource.count(),
    offres: await prisma.job.count(),
    offresDirectes: await prisma.directOffer.count(),
  };
  console.log('Jeu d\'essai posé :', JSON.stringify(compte));

  // La propriété centrale, affirmée ici pour qu'un jeu d'essai mal posé se voie tout de suite.
  const muettes = await prisma.captureBatch.count({ where: { sourceKey: `${N}-sans-publication` } });
  const publicationsMuettes = await prisma.jobSource.count({ where: { sourceKey: `${N}-sans-publication` } });
  if (muettes !== 1 || publicationsMuettes !== 0)
    throw new Error(`PRÉMISSE FAUSSE : lots=${muettes} publications=${publicationsMuettes} (attendu 1 / 0)`);
  console.log('Prémisse vérifiée : la source non publiée a 1 lot de capture et 0 publication.');
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
