/**
 * EXPORTER LE CATALOGUE ET LES CANDIDATS — lecture seule.
 *
 *   python3 apps/aggregator/scripts/ops/db.py readonly npx tsx \
 *     apps/aggregator/scripts/ops/exporter-catalogue.mts <dossier>
 *
 * Produit trois fichiers :
 *
 *   catalogue-sources.csv   les 537 sources du registre, avec leur état RÉEL de collecte :
 *                           domaine officiel résolu, périmètre relu, captures, extractions,
 *                           offres publiées, offres refusées. Une ligne par source.
 *   candidats-valides.csv   les sources que la campagne peut instruire aujourd'hui — celles qui
 *                           passent les préconditions : ACTIVE, famille sous contrat de portail,
 *                           domaine officiel résolu.
 *   offres-publiees.csv     les offres du catalogue, avec leur source et leur Maison.
 *
 * Rien n'est déduit : chaque colonne est comptée en base. Une source sans domaine sort avec la
 * case vide, pas avec une valeur devinée.
 */
import { PrismaClient } from '@prisma/client';
import { writeFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

const dossier = process.argv[2];
if (!dossier) { console.error('Usage : exporter-catalogue.mts <dossier>'); process.exit(2); }

const url = process.env.DB_URL ?? process.env.DATABASE_URL;
if (!url) { console.error('DB_URL (ou DATABASE_URL) manquante.'); process.exit(1); }
const prisma = new PrismaClient({ datasources: { db: { url } } });

const cible = resolve(dossier);
mkdirSync(cible, { recursive: true });

/** Un point-virgule ou un saut de ligne dans une valeur casserait la colonne suivante. */
const csv = (v: unknown) => {
  const s = String(v ?? '');
  return /[;\n"]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
const ecrire = (nom: string, entetes: string[], lignes: unknown[][]) => {
  const chemin = resolve(cible, nom);
  writeFileSync(chemin, '﻿' + [entetes.join(';'), ...lignes.map((l) => l.map(csv).join(';'))].join('\n') + '\n');
  console.log(`   ${nom.padEnd(26)} ${String(lignes.length).padStart(6)} ligne(s)`);
};

/* La résolution du domaine suit les trois voies de la campagne, dans le même ordre. */
const DOMAINE = `COALESCE(
  (SELECT c.domain FROM "JobSource" js JOIN "Job" j ON j.id=js."jobId"
     JOIN "Company" c ON c.id=j."companyId"
    WHERE js."sourceKey"=s.key AND c.domain IS NOT NULL LIMIT 1),
  (SELECT c.domain FROM "Company" c WHERE c.name=s.maison AND c.domain IS NOT NULL LIMIT 1),
  (SELECT c.domain FROM "Company" c
    WHERE lower(regexp_replace(c.name,'[^a-z0-9]','','gi'))
        = lower(regexp_replace(split_part(s.maison,'(',1),'[^a-z0-9]','','gi'))
      AND c.domain IS NOT NULL LIMIT 1))`;

const sources = await prisma.$queryRawUnsafe<Array<Record<string, unknown>>>(`
  SELECT s.key, s.maison, s.kind, s.status, s.tier, s."careersDomain", s."portalScope",
         s.config::text AS config, s."tenantKey", s."jobUrlPattern", s.note,
         s."lastRunAt", s."lastRunStatus", s."lastRunJobs",
         s."descriptionRate", s."dateRate", s."countryRate", s."urlRate",
         (SELECT o."extractedCount" FROM "CaptureBatch" b JOIN "CaptureOutcome" o ON o."batchId"=b.id
           WHERE b."sourceKey"=s.key AND b.purpose='JOBS' AND o.status='EXTRACTED'
           ORDER BY b."startedAt" DESC LIMIT 1)                                                       AS offres_vues,
         ${DOMAINE} AS domaine_officiel,
         (SELECT count(*)::int FROM "CaptureBatch" b WHERE b."sourceKey"=s.key AND b.purpose='JOBS')  AS lots_offres,
         (SELECT count(*)::int FROM "SourceExtraction" e JOIN "CaptureBatch" b ON b.id=e."batchId"
           WHERE b."sourceKey"=s.key)                                                                 AS extractions,
         (SELECT count(*)::int FROM "JobSource" js WHERE js."sourceKey"=s.key)                        AS offres_publiees,
         (SELECT count(*)::int FROM "PipelineEvent" p WHERE p."sourceKey"=s.key
           AND p.event='job.write_failed')                                                            AS offres_refusees,
         (SELECT p.payload->'error'->>'proposedName' FROM "PipelineEvent" p WHERE p."sourceKey"=s.key
           AND p.event='job.write_failed' ORDER BY p.at DESC LIMIT 1)                                 AS dernier_motif_refus
    FROM "Source" s ORDER BY s.status, s.kind, s.key`);

console.log(`\nEXPORT — ${cible}\n`);
ecrire('catalogue-sources.csv',
  ['cle', 'maison', 'ats', 'statut', 'palier', 'domaine_carrieres', 'domaine_officiel',
   'portail_une_seule_marque', 'config_url', 'tenant', 'motif_url_offre',
   'offres_vues', 'lots_offres', 'extractions', 'offres_publiees', 'offres_refusees', 'dernier_motif_refus',
   'derniere_collecte', 'dernier_statut', 'dernieres_offres',
   'taux_description', 'taux_date', 'taux_pays', 'taux_url', 'note', 'a_garder'],
  sources.map((s) => [s.key, s.maison, s.kind, s.status, s.tier, s.careersDomain, s.domaine_officiel,
    s.portalScope, s.config, s.tenantKey, s.jobUrlPattern,
    s.offres_vues, s.lots_offres, s.extractions, s.offres_publiees, s.offres_refusees, s.dernier_motif_refus,
    s.lastRunAt, s.lastRunStatus, s.lastRunJobs,
    s.descriptionRate, s.dateRate, s.countryRate, s.urlRate, s.note, '']));

/*
 * Les candidats VALIDÉS : ceux que la campagne peut instruire. Les familles sont celles de
 * `source-campaign-candidates.sql` — hors de cette liste, aucun contrat de portail n'existe et la
 * campagne ne sélectionne pas la source.
 */
const FAMILLES = ['teamtailor', 'ashby', 'recruitee', 'workday', 'greenhouse', 'smartrecruiters-whitelabel',
  'smartrecruiters', 'successfactors', 'lever', 'personio', 'workable', 'talentsoft', 'digitalrecruiters',
  'flatchr', 'talentview', 'phenom', 'jibe', 'generic-listing', 'generic-jsonld', 'lvmh_algolia'];

/*
 * Une fiche de candidat doit permettre de VÉRIFIER la source, pas seulement de la nommer. On
 * exporte donc l'URL réellement interrogée (`config`, d'où l'adaptateur part), le tenant, le
 * dernier résultat de collecte et les taux de couverture observés — sans quoi le relecteur ne peut
 * ni ouvrir le portail, ni juger si la source vaut d'être gardée.
 */
const candidats = await prisma.$queryRawUnsafe<Array<Record<string, unknown>>>(`
  SELECT s.key, s.maison, s.kind, s.tier, s."careersDomain", s."portalScope", s."tenantKey",
         s.config::text AS config, s."jobUrlPattern", s.note,
         s."lastRunAt", s."lastRunStatus", s."lastRunJobs",
         s."descriptionRate", s."dateRate", s."countryRate", s."urlRate",
         ${DOMAINE} AS domaine_officiel,
         (SELECT count(*)::int FROM "JobSource" js WHERE js."sourceKey"=s.key)                        AS offres_publiees,
         (SELECT count(*)::int FROM "SourceExtraction" e JOIN "CaptureBatch" b ON b.id=e."batchId"
           WHERE b."sourceKey"=s.key)                                                                 AS extractions,
         (SELECT o."extractedCount" FROM "CaptureBatch" b JOIN "CaptureOutcome" o ON o."batchId"=b.id
           WHERE b."sourceKey"=s.key AND b.purpose='JOBS' AND o.status='EXTRACTED'
           ORDER BY b."startedAt" DESC LIMIT 1)                                                       AS offres_vues,
         (SELECT count(*)::int FROM "PipelineEvent" p WHERE p."sourceKey"=s.key
           AND p.event='job.write_failed')                                                            AS offres_refusees
    FROM "Source" s WHERE s.status='ACTIVE' AND s.kind = ANY($1::text[])
   ORDER BY s.kind, s.key`, FAMILLES);

const pretes = candidats.filter((c) => c.domaine_officiel);
ecrire('candidats-valides.csv',
  ['cle', 'maison', 'ats', 'palier', 'domaine_carrieres', 'domaine_officiel', 'portail_une_seule_marque',
   'config_url', 'tenant', 'motif_url_offre', 'offres_vues', 'extractions', 'offres_publiees', 'offres_refusees',
   'derniere_collecte', 'dernier_statut', 'dernieres_offres',
   'taux_description', 'taux_date', 'taux_pays', 'taux_url', 'note', 'a_garder'],
  pretes.map((c) => [c.key, c.maison, c.kind, c.tier, c.careersDomain, c.domaine_officiel, c.portalScope,
    c.config, c.tenantKey, c.jobUrlPattern, c.offres_vues, c.extractions, c.offres_publiees, c.offres_refusees,
    c.lastRunAt, c.lastRunStatus, c.lastRunJobs,
    c.descriptionRate, c.dateRate, c.countryRate, c.urlRate, c.note, '']));

const offres = await prisma.$queryRawUnsafe<Array<Record<string, unknown>>>(`
  SELECT js."sourceKey", s.kind, co.name AS maison, j.title, j.city, j."countryCode",
         j."employmentTerm", j."workTime", j."occupationCode", j.url, j."postedAt"
    FROM "JobSource" js JOIN "Job" j ON j.id=js."jobId"
    JOIN "Company" co ON co.id=j."companyId" JOIN "Source" s ON s.key=js."sourceKey"
   ORDER BY js."sourceKey", j.title`);

ecrire('offres-publiees.csv',
  ['source', 'ats', 'maison', 'intitule', 'ville', 'pays', 'contrat', 'temps_travail', 'metier', 'url', 'publiee_le'],
  offres.map((o) => [o.sourceKey, o.kind, o.maison, o.title, o.city, o.countryCode,
    o.employmentTerm, o.workTime, o.occupationCode, o.url, o.postedAt]));

const actives = sources.filter((s) => s.status === 'ACTIVE').length;
console.log(`\n   ${sources.length} source(s) au registre · ${actives} ACTIVE`);
console.log(`   ${candidats.length} candidat(s) des familles sous contrat · ${pretes.length} avec domaine officiel résolu`);
console.log(`   ${offres.length} offre(s) publiée(s)\n`);

await prisma.$disconnect();
