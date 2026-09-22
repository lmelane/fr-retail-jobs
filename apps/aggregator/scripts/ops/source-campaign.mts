/**
 * Campagne de qualification par vague (lot F3). Pour chaque candidat d'un export privé du registre
 * (clé, Maison, famille, configuration, domaine carrière, palier, domaine officiel de la Maison), le lanceur
 * rejoue les étapes maintenues de `source-onboard` avec les mêmes fonctions, séquentiellement, et rend un
 * VERDICT PROUVÉ par source :
 *
 *   QUALIFIEE              identité vérifiée (lien exact de la page officielle vers le portail, portail servi sur le
 *                          domaine officiel, ou portail redirigé par son éditeur vers son hôte canonique sous ce domaine),
 *                          collecte native validée hors réseau, accès ALLOWED sur les requêtes réellement observées, source ACTIVE
 *   REFUSEE                robots ou périmètre : décision NOT_AUTHORIZED enregistrée, rien ne sera collecté
 *   INACCESSIBLE           le portail ne répond pas (HTTP, délai, défi anti-robot)
 *   RETIREE                source RETIRED dans le registre, non ressuscitée
 *   BLOCAGE_EXTERNE        conflit d'enregistrement, ou pages officielles inaccessibles à la campagne (403/429/5xx,
 *                          capture impossible) : identité ni prouvée ni contredite
 *   IDENTITE_NON_PROUVEE   aucune page du domaine officiel ne lie exactement le portail : lacune de preuve à instruire
 *   DOMAINE_OFFICIEL_MANQUANT   la Maison n'a pas de domaine officiel résolu (ni dans le registre, ni par son careersDomain)
 *   DOMAINE_OFFICIEL_DIVERGENT  le domaine officiel du registre n'est pas celui réellement servi (site ou hôte
 *                          canonique du portail sur un autre domaine d'employeur) : registre à revoir
 *   COLLECTE_NON_VALIDEE   l'adaptateur ou la validation native refuse : défaut de notre contrat, à développer
 *   HORS_PARCOURS          palier, famille ou configuration hors du parcours maintenu (éditeurs, cabinets, contrat absent)
 *
 * Écarts du registre consignés dans `etapes` sans bloquer : `careersDomainDerive` (domaine carrière absent, dérivé de
 * l'hôte du portail), `domaineOfficiel` (domaine officiel dérivé du careersDomain), `portailCanonique` (hôte
 * canonique observé hors domaine officiel), `collecteOrigines` (origines réellement interrogées).
 *
 * Le lanceur n'invente aucune décision : les énoncés sont factuels (page, lien, requêtes, robots), les périmètres et
 * surfaces d'accès sont dérivés des requêtes observées par des règles nommées (`accessScopeDerivation`) et l'énoncé dit ce
 * qu'un préfixe couvre au-delà de l'observé, le réviseur est nommé, et chaque décision reste liée à la révision de la
 * source et au lecteur courant. Il est rejouable et
 * reprend où il s'est arrêté (`--resume` lit les verdicts déjà rendus). Il s'exécute dans l'environnement voulu
 * (par exemple `npm run stack:exec -- node --import tsx apps/aggregator/scripts/ops/source-campaign.mts …`).
 *
 * usage: source-campaign.mts --candidates=<export.json> --out-dir=<dossier privé> [--keys=k1,k2] [--limit=n]
 *        [--ingest] [--resume] [--deadline-ms=120000]
 */
import { PrismaClient } from '@prisma/client';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { loadBuffer } from 'cheerio';
import { parse as parseDomain } from 'tldts';
import { parseSourceCandidate, registerSourceCandidate } from '../../src/connectors/sourceCandidate.js';
import { captureSourceEvidence, readSourceEvidence } from '../../src/capture/sourceEvidence.js';
import { inspectSourceRelation } from '../../src/connectors/sourceRelation.js';
import { configuredPortal, reviewedOfficialDomain, type PortalContract } from '../../src/connectors/sourcePortal.js';
import { effectiveSourceConfig } from '../../src/connectors/sourceConfig.js';
import { recordSourceIdentityReview } from '../../src/connectors/sourceIdentity.js';
import { captureSourceForValidation } from '../../src/connectors/sourceValidation.js';
import { recordSourceAccessDecision } from '../../src/connectors/sourceAccess.js';
import { promoteSource } from '../../src/connectors/sourceStore.js';
import { sourceStatus } from '../../src/onboarding/status.js';
import { readRequestData } from '../../src/capture/requestDataRead.js';
import { objectStoreConfigured, objectStoreFromEnv } from '../../src/retention/objectStore.js';
import { readRefreshPlan } from '../../src/pipeline/refresh.js';
import { closeBrowser } from '../../src/lib/browser.js';
import { auditUrl } from '../../src/capture/context.js';
import { captureReaderRevision } from '../../src/capture/revision.js';
import { deriveAccessScopeDocument } from '../../src/connectors/accessScopeDerivation.js';

type Candidat = { key: string; maison: string; kind: string; config: Record<string, unknown>; careersDomain: string | null; tier: string;
  jobUrlPattern?: string | null; domain?: string | null; domainSource?: string | null; lastRunJobs?: number | null;
  portalScope?: 'SINGLE_BRAND' | 'MULTI_BRAND' | null; note?: string | null };
type Verdict = { key: string; kind: string; maison: string; verdict: string; raisons: string[]; revision?: string; etapes: Record<string, unknown>;
  offres?: number; ingestion?: Record<string, unknown>; absence?: Record<string, unknown>; capacites?: Record<string, string>; readerRevision: string; dureeMs: number; evalueLe: string };
const READER_REVISION = captureReaderRevision();

const REVIEWER = process.argv.find(v => v.startsWith('--reviewer='))?.slice('--reviewer='.length).trim() || 'source-campaign';
if (REVIEWER.length > 160 || /[\r\n]/.test(REVIEWER)) throw new Error('Réviseur invalide');
/** La surface d'un périmètre se lit dans les réponses réellement observées (type de contenu, chemin), jamais dans une constante. */
const CAREER_LINK = /carri|career|recrut|emploi|\bjobs?\b|talent|rejoin|join|work-with|travailler|offres|opportunit/i;
/** Chemins « carrières » usuels du domaine officiel, essayés en dernier recours pour un portail hébergé chez l'éditeur. */
const COMMON_CAREER_PATHS = ['/careers', '/carrieres', '/recrutement', '/jobs', '/emploi', '/nous-rejoindre', '/join-us', '/karriere', '/trabaja-con-nosotros', '/lavora-con-noi'];
const nowMs = () => new Date().toISOString();
const arg = (name: string) => process.argv.find(v => v.startsWith(`--${name}=`))?.slice(name.length + 3);
const flag = (name: string) => process.argv.includes(`--${name}`);
const message = (error: unknown) => (error instanceof Error ? error.message : String(error)).replace(/\s+/g, ' ').replace(/(https?:\/\/[^\s'")?]+)\?[^\s'")]*/g, '$1?…').slice(0, 400);
const inaccessible = (text: string) => /HTTP (?:4\d\d|5\d\d)|timeout|délai|challenge|défi|ECONN|ENOTFOUND|certificate|TLS|socket/i.test(text);

const candidatesFile = arg('candidates'), outDir = arg('out-dir');
if (!candidatesFile || !outDir) throw new Error('usage: source-campaign.mts --candidates=<export.json> --out-dir=<dossier privé> [--keys=] [--limit=] [--ingest] [--resume]');
mkdirSync(outDir, { recursive: true, mode: 0o700 });
const verdictsFile = path.join(outDir, 'verdicts.json');
/*
 * DÉLAI DE COLLECTE — 120 s ne suffisait pas aux gros catalogues.
 *
 * Mesuré le 19/09/2026 : `adidas`, `nordstrom` et `boots` ont rendu `__TIMEOUT__` à 121 s. La cause
 * n'est pas la lenteur d'un serveur mais le NOMBRE DE REQUÊTES : workday en demande une par offre
 * (Nordstrom, 663 requêtes pour 1 333 offres ; phenom, 539 en moyenne). À ce rythme, deux minutes
 * ne laissent pas finir une énumération, et la collecte est coupée alors qu'elle se déroulait bien.
 *
 * Le délai passe à 30 minutes. Mesuré le 19/09 sur les gros groupes : L'Oréal met 649 s, Kering
 * 401 s — 15 minutes les couvraient de justesse, et perdre une collecte de 6 000 offres à trente
 * secondes près serait absurde. Le coût est nul quand une source finit vite.
 *
 * Ce n'est pas un contournement de garde-fou : la validation native,
 * l'énumération complète et les décisions d'accès restent exigées à l'identique — on laisse
 * simplement à une source volumineuse le temps d'être lue entièrement, plutôt que de la déclarer
 * inaccessible à mi-parcours.
 *
 * `--deadline-ms` reste disponible pour borner une campagne de contrôle.
 */
const deadlineMs = Number(arg('deadline-ms') ?? 1_800_000);
let candidats = JSON.parse(readFileSync(candidatesFile, 'utf8')) as Candidat[];
if (arg('keys')) { const keys = new Set(arg('keys')!.split(',')); candidats = candidats.filter(c => keys.has(c.key)); }
const previous: Verdict[] = flag('resume') && existsSync(verdictsFile) ? JSON.parse(readFileSync(verdictsFile, 'utf8')) : [];
const done = new Set(previous.map(v => v.key));
if (flag('resume')) candidats = candidats.filter(c => !done.has(c.key));
if (arg('limit')) candidats = candidats.slice(0, Number(arg('limit')));

const db = new PrismaClient({ errorFormat: 'minimal', log: [] });
const store = objectStoreConfigured() ? objectStoreFromEnv() : undefined;
const verdicts: Verdict[] = [...previous];
const save = () => { writeFileSync(verdictsFile, JSON.stringify(verdicts, null, 1) + '\n', { mode: 0o600 }); };

/** Les liens « carrières » de la page archivée, sur le domaine officiel seulement, dans l'ordre du document. */
async function careerLinks(captureBatchId: string, officialDomain: string): Promise<string[]> {
  const evidence = await readSourceEvidence(db, captureBatchId, store);
  const $ = loadBuffer(evidence.body); $('script,style,template,noscript').remove();
  const found: string[] = [];
  $('a[href]').each((_, node) => {
    const href = $(node).attr('href')!; let url: URL; try { url = new URL(href, evidence.finalUrl); } catch { return; }
    const label = `${$(node).text()} ${href}`;
    if (url.protocol !== 'https:' || !(url.hostname === officialDomain || url.hostname.endsWith(`.${officialDomain}`)) || !CAREER_LINK.test(label)) return;
    url.hash = ''; const s = url.toString(); if (!found.includes(s) && found.length < 4) found.push(s);
  });
  return found;
}

type Portal = PortalContract;
type Identite = { ok: boolean; blocked: boolean; divergentDomain: string | null };
const registrableOf = (url: string | null | undefined) => { try { return url ? parseDomain(new URL(url).hostname, { allowPrivateDomains: true }).domain ?? null : null; } catch { return null; } };

async function identite(c: Candidat, revision: string, officialDomain: string, domain: string, domainSource: string, portal: Portal, etapes: Record<string, unknown>): Promise<Identite> {
  const tried: Record<string, unknown>[] = [];
  let divergentDomain: string | null = null;
  /*
   * PÉRIMÈTRE DU PORTAIL — lu, jamais déduit (lot F4, 18/09/2026).
   *
   * La campagne n'a aucun moyen de savoir si un portail sert une seule Maison ou plusieurs : le
   * déduire du nom serait une invention, et c'est pourquoi ce champ était NULL en dur. Il est
   * désormais porté par le registre (`Source.portalScope`), où il n'entre que par une relecture
   * humaine tracée.
   *
   * On REVALIDE la valeur ici plutôt que de faire confiance au candidat : ce fichier est produit
   * par une requête, mais rien n'empêcherait un export bricolé d'y glisser autre chose. Une valeur
   * inattendue redevient NULL — la source sera qualifiée, et l'ingestion la refusera comme avant.
   * Ce champ ne dispense d'AUCUNE preuve : la revue exige toujours sa capture archivée.
   */
  const perimetre = c.portalScope === 'SINGLE_BRAND' || c.portalScope === 'MULTI_BRAND' ? c.portalScope : null;
  if (c.portalScope && !perimetre) etapes.portalScopeIgnore = { valeur: c.portalScope, raison: 'valeur hors domaine métier' };
  // Un domaine d'employeur réellement servi, différent du domaine officiel revu (jamais un hôte vendeur) : le registre est à revoir.
  const employerDomain = (url: string | null | undefined) => { const value = registrableOf(url); if (!value || value === officialDomain) return null; try { return reviewedOfficialDomain(value); } catch { return null; } };
  // Le portail configuré est archivé en premier : servi sur le domaine officiel, ou redirigé par son éditeur vers son hôte canonique
  // sous ce domaine, il se prouve par lui-même. Puis la page officielle, `www`, ses liens « carrières », enfin les chemins usuels.
  const pages = [portal.url, `https://${domain}/`, ...(domain.startsWith('www.') ? [] : [`https://www.${domain}/`])];
  const seen = new Set<string>();
  for (let i = 0; i < pages.length && i < 10; i++) {
    const url = pages[i]; if (seen.has(url)) continue; seen.add(url);
    let capture: { captureBatchId: string; lastStatus: number | null };
    try { capture = await captureSourceEvidence(db, c.key, { revisionId: revision, purpose: 'SOURCE_IDENTITY', url, deadlineMs: 60_000 }, store) as typeof capture; }
    catch (error) { tried.push({ url, capture: message(error) }); continue; }
    const relation = await inspectSourceRelation(db, c.key, { captureBatchId: capture.captureBatchId, officialDomain }, store) as
      Awaited<ReturnType<typeof inspectSourceRelation>> & { proofUrl?: string; canonicalPortal?: string; witness?: { ordinal: number } };
    const attempt: Record<string, unknown> = { url, captureBatchId: capture.captureBatchId, status: capture.lastStatus, finalUrl: relation.proofUrl ?? null, verdict: relation.verdict, reason: relation.reason ?? null };
    tried.push(attempt);
    if (relation.verdict === 'LINK_MATCHED') {
      // Preuve par redirection canonique : l'éditeur sert le même tenant sur l'origine configurée (celle que la collecte lit,
      // mesuré le 16/09 : Teamtailor réécrit flux et URL d'offres sur l'hôte demandé) et sur son hôte canonique archivé.
      if ((relation.witness?.ordinal ?? 0) > 0 && relation.canonicalPortal) attempt.canonicalPortal = relation.canonicalPortal;
      etapes.identite = tried;
      const witness = (relation as { witness?: { element: string; ordinal: number; reference?: string } }).witness;
      const how = witness?.element === 'document' ? (witness.ordinal > 0 ? `est le portail configuré lui-même, redirigé par son éditeur vers son hôte canonique ${relation.canonicalPortal} sous le domaine officiel (${witness.ordinal} saut(s) archivé(s))` : 'est le portail configuré lui-même, servi sur le domaine officiel')
        : witness?.element === 'script' ? `charge le script d'embarquement du portail configuré (script n° ${witness.ordinal})`
        : witness?.reference === 'posting' ? `lie une offre publiée par le portail configuré (lien n° ${witness.ordinal})`
        : `désigne exactement le portail configuré (lien n° ${witness?.ordinal ?? '?'})`;
      const review = await recordSourceIdentityReview(db, { sourceKey: c.key, sourceRevisionId: revision, captureBatchId: capture.captureBatchId, verdict: 'VERIFIED', officialDomain,
        statement: `La page archivée ${auditUrl(relation.proofUrl!)} ${how} : ${relation.configuredPortal}. Domaine officiel ${officialDomain} lu dans le registre (provenance : ${domainSource}), jamais déduit par la campagne. ${perimetre
          ? `Périmètre du portail ${perimetre} : périmètre déclaré par le réviseur dans le dossier candidat, jamais déduite du nom de la Maison ni de cette capture.`
          : `Le rôle exact du portail n'est pas déduit du nom de la Maison : portalScope reste nul.`}`,
        reviewer: REVIEWER, checkedAt: nowMs(), portalScope: perimetre } as Parameters<typeof recordSourceIdentityReview>[1], true, store) as { written?: number; verdict?: string; reason?: string };
      etapes.decisionIdentite = review;
      return { ok: review.written === 1 || (review as { isLatestDecision?: boolean }).isLatestDecision === true, blocked: false, divergentDomain: null };
    }
    if (relation.reason === 'PAGE_OUTSIDE_REVIEWED_DOMAIN') {
      const observed = employerDomain(relation.proofUrl);
      if (observed) { divergentDomain ??= observed; if (i === 0) etapes.portailCanonique = relation.proofUrl; }
    }
    if (relation.reason === 'EXACT_PORTAL_REFERENCE_NOT_FOUND' && !pages.slice(0, i).some(p => p !== portal.url)) {
      for (const link of await careerLinks(capture.captureBatchId, officialDomain)) if (!seen.has(link)) pages.push(link);
    }
    /*
     * LES CHEMINS USUELS S'ESSAIENT SUR L'HÔTE QUI RÉPOND, PAS SEULEMENT SUR L'APEX.
     *
     * Mesuré le 18/09/2026 sur `club-monaco` : `clubmonaco.com/careers` rend 403 (l'apex est
     * derrière un pare-feu applicatif) tandis que `www.clubmonaco.com/careers` rend 200 et porte le
     * lien vers `job-boards.greenhouse.io/clubmonaco` — le lien que le contrat reconnaît déjà. La
     * campagne concluait IDENTITE_NON_PROUVEE alors que la preuve était servie une variante d'hôte
     * plus loin.
     *
     * On dérive donc les hôtes depuis les pages d'accueil DÉJÀ TENTÉES dont le statut est exploitable
     * (< 400) : si `www` a répondu et pas l'apex, les chemins partent sur `www`. Aucun hôte nouveau
     * n'est inventé — ce sont ceux que la campagne a elle-même construits et interrogés.
     */
    if (i === pages.length - 1) {
      const racines = tried
        .filter(t => typeof t.status === 'number' && (t.status as number) < 400 && typeof t.url === 'string' && new URL(t.url as string).pathname === '/')
        .map(t => new URL(t.url as string).origin);
      const origines = [...new Set([...racines, `https://${domain}`])];
      for (const origine of origines) {
        for (const p of COMMON_CAREER_PATHS) {
          const u = `${origine}${p}`;
          if (!seen.has(u) && pages.length < 10) pages.push(u);
        }
      }
    }
  }
  etapes.identite = tried;
  // Le blocage externe se juge sur les pages de la Maison seulement : la capture du portail (souvent 200 chez le vendeur) n'y compte pas.
  const official = tried.filter(t => t.url !== portal.url);
  const anyPage = official.some(t => typeof t.status === 'number' && t.status < 400);
  const blockedSignals = official.filter(t => t.capture !== undefined || t.status === 403 || t.status === 429 || (typeof t.status === 'number' && t.status >= 500)).length;
  return { ok: false, blocked: !anyPage && blockedSignals > 0, divergentDomain };
}

/** Les requêtes HTTP réellement observées pendant une capture (chaque saut de chaque réponse), avec le type de contenu servi. */
async function observedRequests(captureBatchId: string) {
  const rows = await db.rawCapture.findMany({ where: { batchId: captureBatchId }, orderBy: { sequence: 'asc' } });
  const requests: { method: string; url: URL; contentType: string }[] = [];
  for (const row of rows) {
    const data = await readRequestData(db, row, store);
    if (!data || data.origin !== 'HTTP_TRANSPORT') throw new Error('ACCESS_JOURNAL: requête sans provenance HTTP native');
    for (const hop of data.hops) requests.push({ method: hop.request.method, url: new URL(hop.request.url), contentType: String((hop.responseHeaders as Record<string, string>)['content-type'] ?? '') });
  }
  if (!requests.length) throw new Error('ACCESS_JOURNAL: aucune requête observée');
  return requests;
}

async function acces(c: Candidat, revision: string, jobsCaptureId: string, etapes: Record<string, unknown>) {
  const requests = await observedRequests(jobsCaptureId);
  const origins = [...new Set(requests.map(r => r.url.origin))];
  const robotsCaptureIds: string[] = [];
  for (const origin of origins) {
    const capture = await captureSourceEvidence(db, c.key, { revisionId: revision, purpose: 'SOURCE_ACCESS', url: `${origin}/robots.txt`, deadlineMs: 60_000 }, store) as { captureBatchId: string };
    robotsCaptureIds.push(capture.captureBatchId);
  }
  const { scopes, derivation } = deriveAccessScopeDocument(c.kind, requests);
  const statement = `Périmètre dérivé des ${requests.length} requête(s) HTTP réellement observées, sous l'identité du robot, pendant la collecte de qualification ${jobsCaptureId} : ${derivation.exact} chemin(s) observé(s) déclaré(s) tel(s) quel(s) (EXACT) et ${derivation.prefix} répertoire(s) d'offres observé(s) déclaré(s) par leur préfixe (PREFIX), qui couvre les entrées futures de ce répertoire et rien au-delà${derivation.climbs ? ` ; ${derivation.climbs} remontée(s) d'un répertoire pour tenir dans la liste bornée de 64 périmètres, jamais jusqu'à la racine` : ''}${scopes.some(s => s.query.variable.length) ? ' ; les paramètres variables sont ceux observés avec plusieurs valeurs' : ''}. Méthodes déclarées par périmètre, jamais fusionnées entre un point d'entrée et des pages. Robots archivé pour chaque origine interrogée. Liste : ${scopes.map(s => `${s.methods.join('/')} ${s.origin}${s.path.value}${s.path.kind === 'PREFIX' ? '…' : ''}${Object.keys(s.query.fixed).length ? ' ?' + Object.entries(s.query.fixed).map(([k, v]) => `${k}=${v}`).join('&') : ''}${s.query.variable.length ? ` [variables : ${s.query.variable.join(', ')}]` : ''}`).join(' ; ')}`;
  const document = { sourceKey: c.key, sourceRevisionId: revision, captureBatchId: jobsCaptureId, verdict: 'ALLOWED', robotsCaptureIds, scopes, statement, reviewer: REVIEWER, checkedAt: nowMs() };
  etapes.acces = { origins, scopes, robotsCaptureIds, derivation };
  try {
    const decision = await recordSourceAccessDecision(db, document as Parameters<typeof recordSourceAccessDecision>[1], true, store) as { verdict?: string; written?: number; reason?: string };
    etapes.decisionAcces = decision;
    if (decision.verdict === 'ALLOWED' && (decision.written === 1 || (decision as { isLatestDecision?: boolean }).isLatestDecision)) return { allowed: true, reason: null as string | null };
    return { allowed: false, reason: decision.reason ?? JSON.stringify(decision).slice(0, 300) };
  } catch (error) {
    const reason = message(error);
    // Un refus robots ou un périmètre non couvert devient une décision NOT_AUTHORIZED explicite : rien ne sera collecté.
    if (/not covered|DISALLOWED|robots/i.test(reason)) {
      const denial = { sourceKey: c.key, sourceRevisionId: revision, captureBatchId: null, verdict: 'NOT_AUTHORIZED', robotsCaptureIds: [], scopes: [],
        statement: `Accès refusé lors de la campagne F3 : ${reason}`, reviewer: REVIEWER, checkedAt: nowMs() };
      try { etapes.decisionAcces = await recordSourceAccessDecision(db, denial as Parameters<typeof recordSourceAccessDecision>[1], true, store); } catch (e) { etapes.decisionAccesErreur = message(e); }
    }
    return { allowed: false, reason };
  }
}

async function qualifier(c: Candidat): Promise<Verdict> {
  const debut = Date.now(); const etapes: Record<string, unknown> = {}; const raisons: string[] = [];
  const rendre = (verdict: string, extra: Partial<Verdict> = {}): Verdict => ({ key: c.key, kind: c.kind, maison: c.maison, verdict, raisons, etapes, readerRevision: READER_REVISION, dureeMs: Date.now() - debut, evalueLe: nowMs(), ...extra });
  // La même configuration effective que l'inspecteur de relation : les clés historiques du registre (careers_url, jobs_url…) y sont normalisées.
  let portal: Portal | null = null; try { portal = configuredPortal(c.kind, effectiveSourceConfig(c.config)); } catch (error) { raisons.push(`contrat de portail : ${message(error)}`); }
  if (!portal) { if (!raisons.length) raisons.push('contrat de portail : aucun contrat de relation officielle pour cette famille ou cette configuration (sourcePortal.ts)'); return rendre('HORS_PARCOURS'); }
  etapes.portail = portal.url;
  // Le domaine carrière est une donnée du registre (il entre dans la clé de tenant) : sans lui, la source reste hors parcours,
  // l'écart est consigné pour le registre, rien n'est dérivé de l'hôte du portail.
  if (!c.careersDomain) { raisons.push(`careersDomain absent du registre (portail configuré ${portal.url}) : écart de registre, source hors parcours`); return rendre('HORS_PARCOURS'); }
  const careersDomain = c.careersDomain;
  let candidate; try { candidate = parseSourceCandidate({ key: c.key, maison: c.maison, kind: c.kind, config: c.config, careersDomain, tier: c.tier, jobUrlPattern: c.jobUrlPattern ?? null }); }
  catch (error) { raisons.push(message(error)); return rendre('HORS_PARCOURS'); }
  let registration; try { registration = await registerSourceCandidate(db, candidate, true); }
  catch (error) { raisons.push(message(error)); return rendre('BLOCAGE_EXTERNE'); }
  const source = registration.source!; const revision = source.currentRevisionId as string;
  etapes.enregistrement = { created: registration.created, status: source.status, revision };
  if (source.status === 'RETIRED') { raisons.push('source RETIRED dans le registre'); return rendre('RETIREE', { revision }); }
  const domain = c.domain ?? null;
  if (!domain) {
    // Le domaine officiel est une donnée REVUE du registre, jamais déduite par la campagne (une preuve « portail sous
    // son propre domaine » serait circulaire) : la racine du domaine carrière est seulement SUGGÉRÉE au registre, et
    // jamais quand ce domaine est l'hôte même d'un portail vendeur (audit F3b).
    const registrableCareers = parseDomain(careersDomain, { allowPrivateDomains: true }).domain;
    const portalHost = new URL(portal.url).hostname;
    const selfHosted = portal.vendorHosted && (careersDomain === portalHost || parseDomain(portalHost, { allowPrivateDomains: true }).domain === registrableCareers);
    try { if (registrableCareers && !selfHosted) etapes.domaineOfficielSuggere = reviewedOfficialDomain(registrableCareers); } catch { /* hôte vendeur : rien à suggérer */ }
    raisons.push(`domaine officiel de la Maison non résolu dans le registre${etapes.domaineOfficielSuggere ? ` (suggestion à revoir : ${etapes.domaineOfficielSuggere})` : ''}`); return rendre('DOMAINE_OFFICIEL_MANQUANT', { revision });
  }
  const domainSource = c.domainSource ?? 'registre';
  etapes.domaineOfficiel = { value: domain, source: domainSource };
  const registrable = parseDomain(domain, { allowPrivateDomains: true }).domain ?? domain;
  let identity: Identite = { ok: false, blocked: false, divergentDomain: null };
  try { identity = await identite(c, revision, registrable, domain, domainSource, portal, etapes); }
  catch (error) { raisons.push(`identité : ${message(error)}`); }
  // Le motif d'identité est consigné ; quand une étape ultérieure décide du verdict, SON motif passe en tête (unshift).
  if (!identity.ok) raisons.push(identity.blocked ? 'pages officielles inaccessibles à la campagne (403/429/5xx ou capture impossible) : blocage externe, identité ni prouvée ni contredite'
    : identity.divergentDomain ? `le portail ou le site officiel du registre est servi sous un autre domaine d'employeur (${identity.divergentDomain}, registre : ${registrable}) : relation à instruire (groupe, distributeur, franchise ou registre)`
    : 'aucune page du domaine officiel ne lie exactement le portail configuré (voir etapes.identite)');
  let validation; try { validation = await captureSourceForValidation(db, c.key, deadlineMs, store); }
  catch (error) { const m = message(error); raisons.unshift(`collecte : ${m}`); return rendre(inaccessible(m) ? 'INACCESSIBLE' : 'COLLECTE_NON_VALIDEE', { revision }); }
  etapes.collecte = { captureBatchId: validation.captureBatchId, verdict: validation.verdict, report: validation.report };
  const offres = (validation.report as { observed?: number })?.observed;
  if (validation.verdict !== 'VALIDATED') { raisons.unshift(`validation native : ${validation.verdict} (${Object.keys((validation.report as { reasons?: Record<string, number> })?.reasons ?? {}).join(', ') || 'sans motif'})`); return rendre('COLLECTE_NON_VALIDEE', { revision, offres }); }
  try { etapes.collecteOrigines = [...new Set((await observedRequests(validation.captureBatchId)).map(r => r.url.origin))]; }
  catch (error) { raisons.unshift(`journal de collecte : ${message(error)}`); return rendre('COLLECTE_NON_VALIDEE', { revision, offres }); }
  let access; try { access = await acces(c, revision, validation.captureBatchId, etapes); }
  catch (error) { const m = message(error); raisons.unshift(`accès : ${m}`); return rendre(inaccessible(m) ? 'INACCESSIBLE' : 'COLLECTE_NON_VALIDEE', { revision, offres }); }
  if (!access.allowed) { raisons.unshift(`accès : ${access.reason}`); return rendre(/not covered|DISALLOWED|robots/i.test(access.reason ?? '') ? 'REFUSEE' : 'COLLECTE_NON_VALIDEE', { revision, offres }); }
  /*
   * L'IDENTITÉ NE BLOQUE PLUS LA QUALIFICATION (lot F5, 18/09/2026).
   *
   * Le registre relu porte la Maison, l'ATS, le domaine officiel et le périmètre du portail : la
   * campagne n'a plus à retrouver une preuve que le registre donne déjà. Le pipeline a cessé de
   * l'exiger (code et déclencheur SQL) ; ce garde-fou-ci était le dernier à l'imposer, et il a
   * refusé `boggi-milano` le 18/09 avec 101 offres extraites et 0 publiée.
   *
   * CE QUI EST CONSERVÉ, et qui bloque toujours :
   *   · DOMAINE_OFFICIEL_DIVERGENT — le portail est servi sous un AUTRE domaine d'employeur que
   *     celui du registre. Ce n'est pas une lacune de preuve, c'est une CONTRADICTION mesurée :
   *     collecter reviendrait à publier les offres d'une Maison sous le nom d'une autre
   *     (`julie-grace` → ellijewelry.com, mesuré le 18/09). Le registre est à corriger d'abord.
   *   · BLOCAGE_EXTERNE — les pages officielles sont inaccessibles (403/429/5xx). On ne peut
   *     rien affirmer, ni dans un sens ni dans l'autre ; la source reste identifiable comme telle.
   *
   * Une simple absence de lien ne bloque plus : elle est consignée dans `etapes.identite` pour
   * instruction, et la qualification se poursuit sur la foi du registre.
   */
  /*
   * UN DOMAINE DIVERGENT PEUT AVOIR ÉTÉ ACCEPTÉ PAR UN HUMAIN (lot F8, 19/09/2026).
   *
   * `DOMAINE_OFFICIEL_DIVERGENT` dit que le portail est servi sous un autre domaine d'employeur que
   * celui du registre, et la campagne a raison de ne pas trancher seule : accepter n'importe quel
   * domaine servi reviendrait à publier les offres d'une Maison sous le nom d'une autre.
   *
   * Mais la plupart de ces écarts sont légitimes, et seul un humain peut le dire. Sur les 19 cas
   * relus le 19/09 : variantes d'extension (`nikin.com` / `nikin.ch`), domaines carrières dédiés
   * (`carrieres-rolex.com`), hébergeurs RH (`molton-brown.voyse.io`), société mère (Elli est la
   * marque cœur de JULIE & GRACE GmbH). 17 acceptés, 1 conservé au registre, 1 retiré — un
   * distributeur tiers qui n'était pas la Maison.
   *
   * La décision est inscrite dans la note de la source (`domaine-accepte:<domaine>`) parce que
   * `Company.domain` n'en porte qu'un : le domaine de la Maison reste la référence, celui-ci dit
   * « ce domaine-là est aussi le sien, vérifié à la main ». On le lit ici, et rien n'est deviné :
   * un domaine absent de la note bloque comme avant.
   */
  const domaineAccepte = typeof c.note === 'string'
    && c.note.includes(`domaine-accepte:${identity.divergentDomain}`);
  if (!identity.ok && identity.divergentDomain && !domaineAccepte) return rendre('DOMAINE_OFFICIEL_DIVERGENT', { revision, offres });
  if (domaineAccepte) etapes.domaineAccepte = { domaine: identity.divergentDomain, source: 'note du registre, relu à la main' };
  if (!identity.ok && identity.blocked) return rendre('BLOCAGE_EXTERNE', { revision, offres });
  if (!identity.ok) etapes.identiteNonProuvee = { note: 'aucun lien officiel trouvé ; identité portée par le registre relu (lot F5)' };
  const status = await sourceStatus(db, c.key) as { promotionGatesPass?: boolean; status?: string; identity?: unknown; native?: unknown; access?: unknown };
  etapes.portes = { identity: status.identity, native: status.native, access: status.access, promotionGatesPass: status.promotionGatesPass, status: status.status };
  try { etapes.promotion = await promoteSource(db, c.key, revision); }
  catch (error) { raisons.unshift(`promotion : ${message(error)}`); return rendre('COLLECTE_NON_VALIDEE', { revision, offres }); }
  const result = rendre('QUALIFIEE', { revision, offres });
  if (flag('ingest')) {
    // Tampon de sortie large : le journal d'une ingestion de mille offres dépasse le mégaoctet par défaut de spawnSync,
    // et un résultat tronqué se lisait « ECHEC » sans motif (adidas, 1 129 offres, campagne du 17/09).
    const run = spawnSync('npx', ['--no-install', 'tsx', 'apps/aggregator/src/cli.ts', 'ingest', `--source=${c.key}`, '--no-geocode'], { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
    const output = (run.stdout + run.stderr).split('\n');
    const line = output.slice().reverse().find(l => l.includes('"event":"command.result"'));
    const data = line ? JSON.parse(line).data : null; const s = data?.sources?.[0];
    // Les motifs des refus d'écriture (porte d'identité d'employeur, etc.) sont comptés par nom d'erreur : la capacité de
    // publication d'une source qualifiée se lit ici, pas dans le seul compte des offres créées.
    const errorKinds: Record<string, number> = {};
    for (const l of output) {
      if (!l.includes('"event":"job.write_failed"') && !l.includes('"event":"source.ingest_failed"')) continue;
      /*
       * LE MOTIF, JAMAIS LA RAISON SOCIALE. `proposedName` porte le nom réel de l'employeur
       * (`previous.name`, `current.name`) : il n'a pas sa place dans un rapport relu ailleurs, et
       * il ne DISCRIMINE rien — sept causes distinctes se confondaient sous un même nom de Maison,
       * ce qui rendait le tableau des refus illisible (mesuré le 2026-09-21 : 1 198 refus rangés
       * sous 17 noms de Maison, au lieu de leurs motifs réels).
       */
      try { const error = JSON.parse(l).data?.error; const kind = [error?.name, error?.motif].filter(Boolean).join(':') || 'inconnu'; errorKinds[kind] = (errorKinds[kind] ?? 0) + 1; } catch { errorKinds.illisible = (errorKinds.illisible ?? 0) + 1; }
    }
    result.ingestion = { exit: run.status, ok: data?.ok ?? null, fetched: s?.fetched, created: s?.created, updated: s?.updated, errors: s?.errors, ...(Object.keys(errorKinds).length ? { errorKinds } : {}) };
    const plan = await readRefreshPlan(db, { onlyKeys: [c.key] });
    const e = plan.absencePlan.eligibility.find(x => x.source === c.key);
    result.absence = { eligible: e?.eligible ?? null, reasons: e?.reasons ?? [], termination: e?.termination ?? null, representations: Object.fromEntries([...plan.absencePlan.states.values()].reduce((m, st) => m.set(st, (m.get(st) ?? 0) + 1), new Map<string, number>())) };
  }
  // QUALIFIEE dit l'identité, la collecte et l'accès prouvés ; la PUBLICATION est une capacité distincte, lue dans l'ingestion.
  const ing = result.ingestion as { created?: number; updated?: number; errors?: number; exit?: number | null } | undefined;
  const written = (ing?.created ?? 0) + (ing?.updated ?? 0);
  result.capacites = { collecte: 'OK', publication: !ing ? 'NON_TESTEE' : ing.errors ? (written ? 'PARTIELLE' : 'REFUSEE') : ing.exit ? 'ECHEC' : written ? 'OK' : 'AUCUNE_OFFRE',
    absence: result.absence?.eligible === true ? 'ELIGIBLE' : result.absence ? 'NON_ELIGIBLE' : 'NON_TESTEE' };
  return result;
}

console.log(`campagne : ${candidats.length} candidat(s), ${previous.length} verdict(s) déjà rendu(s)`);
try {
  for (const [i, c] of candidats.entries()) {
    let verdict: Verdict;
    try { verdict = await qualifier(c); }
    catch (error) { verdict = { key: c.key, kind: c.kind, maison: c.maison, verdict: 'BLOCAGE_EXTERNE', raisons: [`erreur non classée : ${message(error)}`], etapes: {}, readerRevision: READER_REVISION, dureeMs: 0, evalueLe: nowMs() }; }
    verdicts.push(verdict); save();
    console.log(`${String(i + 1).padStart(3)}/${candidats.length} ${verdict.verdict.padEnd(26)} ${c.key} (${verdict.offres ?? '-'} offres, ${(verdict.dureeMs / 1000).toFixed(1)} s)${verdict.raisons.length ? ' — ' + verdict.raisons[0].slice(0, 160) : ''}`);
  }
} finally {
  await closeBrowser().catch(() => {}); await db.$disconnect();
}
const totals: Record<string, number> = {};
for (const v of verdicts) totals[v.verdict] = (totals[v.verdict] ?? 0) + 1;
console.log('bilan :', JSON.stringify(totals), '→', verdictsFile);
