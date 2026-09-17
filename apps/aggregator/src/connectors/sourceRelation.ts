import type { PrismaClient } from '@prisma/client';
import { loadBuffer } from 'cheerio';
import { readSourceEvidence } from '../capture/sourceEvidence.js';
import { auditUrl, digestBytes } from '../capture/context.js';
import { captureReaderRevision } from '../capture/revision.js';
import { detectChallenge } from '../lib/responseIntegrity.js';
import type { ObjectStore } from '../retention/objectStore.js';
import { readIdentitySource } from './sourceRegistryRead.js';
import { effectiveSourceConfig } from './sourceConfig.js';
import { belongsToOfficialDomain, configuredPortal, reviewedOfficialDomain, type PortalContract } from './sourcePortal.js';

/**
 * Politique 3 (lot F3, 16/09/2026). Trois témoins établissent la relation entre la page officielle et le portail
 * configuré, toujours depuis l'archive et jamais depuis une page vivante :
 *  - `a` / `iframe` / `script[src]` : un lien HTML actif de la page officielle vers le portail exact (listing), le
 *    chargeur d'embarquement du board (Greenhouse), ou l'une des offres publiées par ce portail (F3b : une page
 *    officielle qui liste les offres de son board désigne ce board ; le témoin porte `reference: 'posting'`) ;
 *  - `document` (ordinal 0) : la page archivée EST le portail, servi sur le domaine officiel revu (domaine
 *    personnalisé `careers.maison.example`, ou le listing configuré sur l'apex / `www`) ;
 *  - `document` (ordinal ≥ 1) : la page archivée est le portail configuré demandé tel quel, que son éditeur redirige
 *    nativement (301/302/307/308, chaîne archivée) vers son hôte canonique sous le domaine officiel revu
 *    (`maison.teamtailor.com` → `careers.maison.example`) ; le rapport porte alors `canonicalPortal` et `redirectChain`.
 * Aucun témoin n'atteste la couverture du flux ni le rôle du portail.
 */
/**
 * Le portail est-il servi SUR le domaine officiel revu (sous-domaine propre, apex ou `www`) ? La relation par le
 * document exige en plus que la page archivée SOIT le portail configuré (`matches`) : la page d'accueil d'une
 * Maison n'est jamais un portail Teamtailor, mais `www.maison.example/carrieres/` est bien le listing configuré.
 */
export function portalUnderOfficialDomain(portalUrl: string, officialDomain: string): boolean {
  try {
    const host = new URL(portalUrl).hostname;
    return host === officialDomain || host === `www.${officialDomain}` || host.endsWith(`.${officialDomain}`);
  } catch { return false; }
}

export const SOURCE_RELATION_POLICY = 'official-html-link/3';

type Chain = { initialUrl: string; finalUrl: string; responses: { requestUrl: string; status: number | null }[] };
const REDIRECT_STATUSES = new Set([301, 302, 307, 308]);

/** Un sous-domaine PROPRE du domaine officiel (`careers.maison.example`) : ni l'apex ni `www`, qui servent le site de la Maison. */
function properSubdomainOf(url: string, officialDomain: string): boolean {
  try { const host = new URL(url).hostname; return host !== officialDomain && host !== `www.${officialDomain}` && host.endsWith(`.${officialDomain}`); } catch { return false; }
}

/**
 * Le portail configuré, demandé tel quel, a-t-il été redirigé par son éditeur vers un hôte canonique sous le domaine
 * officiel revu ? Chaque saut est un 301/302/307/308 archivé, servi par l'origine configurée ou sous le domaine
 * officiel (jamais un autre tenant du vendeur), et la page finale est le même listing réécrit sur l'origine configurée,
 * sur un sous-domaine propre : un éditeur renvoie aussi un site carrière dépublié vers l'accueil de la Maison (apex ou
 * `www`), ce qui n'est pas un portail. Sans redirection, il n'y a pas de déclaration canonique : la page vendeur reste
 * hors domaine.
 */
export function canonicalRedirectToOfficialDomain(portal: PortalContract, chain: Chain, officialDomain: string): boolean {
  if (chain.responses.length < 2 || !portal.matches(chain.initialUrl) || !properSubdomainOf(chain.finalUrl, officialDomain)) return false;
  const origin = new URL(portal.url).origin;
  if (!chain.responses.slice(0, -1).every(row => REDIRECT_STATUSES.has(row.status ?? 0))) return false;
  if (!chain.responses.every(row => {
    try { const url = new URL(row.requestUrl); return url.protocol === 'https:' && (url.origin === origin || belongsToOfficialDomain(row.requestUrl, officialDomain)); } catch { return false; }
  })) return false;
  // The final HOST was authorised above (proper subdomain of the reviewed official domain); this last check only
  // validates the listing SHAPE (path and native filters) by rewriting the final URL onto the configured origin,
  // the only origin the contract's `matches` accepts. It never re-validates the host.
  const final = new URL(chain.finalUrl);
  return portal.matches(new URL(`${final.pathname}${final.search}`, origin).toString());
}

/** Inspect archived HTML, never text snippets or a live fallback. A matching
 * link establishes a relation to the configured board; the official domain's
 * ownership, source role and access authorization still require review.
 *
 * Preuve par le document (lot F3) : quand la page ARCHIVÉE est le portail configuré
 * lui-même servi sur le domaine officiel revu, ou le portail configuré redirigé par
 * son éditeur vers son hôte canonique sous ce domaine, la Maison a délégué ce nom
 * par son DNS ; la relation est prouvée sans lien HTML (témoin `document`). Un
 * hôte vendeur sans redirection canonique reste hors domaine. */
export async function inspectSourceRelation(db: PrismaClient, key: string, options: {
  captureBatchId: string; officialDomain: string;
}, store?: ObjectStore, now = new Date()) {
  options = Object.freeze({ ...options });
  const officialDomain = reviewedOfficialDomain(options.officialDomain);
  const source = await readIdentitySource(db, key);
  if (!source) throw new Error('Registered source required');
  const context = { policy: SOURCE_RELATION_POLICY, sourceKey: key, sourceRevisionId: source.currentRevisionId,
    captureBatchId: options.captureBatchId, officialDomain, evaluatedAt: now.toISOString(), inspectorRevision: captureReaderRevision(),
    identityApproved: false as const, coverageAttested: false as const };
  const invalid = (reason: string) => ({ ...context, archiveVerified: false as const, verdict: 'NOT_PROVEN' as const, reason });
  const batch = await db.captureBatch.findUniqueOrThrow({ where: { id: options.captureBatchId }, include: { outcome: true } });
  if (batch.purpose !== 'SOURCE_IDENTITY') return invalid('IDENTITY_CAPTURE_REQUIRED');
  if (batch.sourceKey !== key || batch.sourceRevisionId !== source.currentRevisionId) return invalid('CAPTURE_REVISION_MISMATCH');
  if (batch.outcome?.status !== 'SOURCE_EVIDENCE') return invalid('CAPTURE_NOT_COMPLETE');
  const age = now.getTime() - batch.startedAt.getTime();
  if (age < -300_000 || age > 30 * 86_400_000) return invalid('CAPTURE_STALE');
  // I/O failures and archive corruption remain operational errors. They must
  // not be hidden as an ordinary absence of a link.
  const evidence = await readSourceEvidence(db, batch.id, store);
  const response = evidence.responses.at(-1)!;
  const archived = { ...context, archiveVerified: true as const, captureObservedAt: batch.startedAt.toISOString(), responseId: response.id,
    bodyHash: response.blobHash!, proofUrl: auditUrl(evidence.finalUrl) };
  const unproven = (reason: string) => ({ ...archived, verdict: 'NOT_PROVEN' as const, reason });
  const portal = configuredPortal(source.kind, effectiveSourceConfig(source.config));
  if (!portal) return unproven('PORTAL_CONFIGURATION_NOT_QUALIFIED');
  const onOfficialDomain = belongsToOfficialDomain(evidence.initialUrl, officialDomain) && belongsToOfficialDomain(evidence.finalUrl, officialDomain) &&
    evidence.responses.every(row => belongsToOfficialDomain(row.requestUrl, officialDomain));
  const canonical = !onOfficialDomain && canonicalRedirectToOfficialDomain(portal, evidence, officialDomain);
  if (!onOfficialDomain && !canonical) return unproven('PAGE_OUTSIDE_REVIEWED_DOMAIN');
  if (response.status! < 200 || response.status! >= 300) return unproven('HTTP_RESPONSE_NOT_USABLE');
  const headers = response.headers as Record<string, string>;
  const contentType = headers['content-type'] ?? '';
  if (!/^text\/html(?:\s*;|\s*$)/i.test(contentType)) return unproven('HTML_DOCUMENT_REQUIRED');
  if (detectChallenge(new Response(null, { status: response.status!, headers }), evidence.body.subarray(0, 16_000).toString('utf8'))) return unproven('CHALLENGE_DOCUMENT');
  const charset = /;\s*charset\s*=\s*["']?([^\s;"']+)/i.exec(contentType)?.[1];
  const $ = loadBuffer(evidence.body, { encoding: { transportLayerEncodingLabel: charset } });
  // These are inert text, not references in the active document. In particular,
  // a quoted URL in a script, comment or template cannot prove the relationship.
  // Only the `src` of a script element is an active reference (an embedded board loader); its inline text never is.
  const embeds: { reference: string; ordinal: number }[] = [];
  $('script[src]').each((ordinal, node) => { embeds.push({ reference: String($(node).attr('src')), ordinal }); });
  $('script,style,template,noscript').remove();
  let base = evidence.finalUrl;
  const declaredBase = $('base[href]').first().attr('href');
  if (declaredBase !== undefined) { try { base = new URL(declaredBase, base).toString(); } catch { /* Invalid base uses the document URL. */ } }
  type Witness = { element: string; attribute: string; ordinal: number; referenceHash: string; resolvedReferenceHash: string; queryKeys: string[]; reference: 'portal' | 'posting' | 'document' };
  let witness: Witness | undefined;
  const queryKeys = [...new Set(new URL(evidence.finalUrl).searchParams.keys())].sort();
  if (canonical) {
    // Le témoin est la chaîne archivée : de l'URL demandée (le portail configuré) à sa page canonique servie sous le domaine officiel.
    witness = { element: 'document', attribute: 'url', ordinal: evidence.responses.length - 1, referenceHash: digestBytes(evidence.initialUrl), resolvedReferenceHash: digestBytes(evidence.finalUrl), queryKeys, reference: 'document' };
  } else if (portal.matches(evidence.finalUrl) && portalUnderOfficialDomain(portal.url, officialDomain)) {
    witness = { element: 'document', attribute: 'url', ordinal: 0, referenceHash: digestBytes(evidence.finalUrl), resolvedReferenceHash: digestBytes(evidence.finalUrl), queryKeys, reference: 'document' };
  }
  const witnessFor = (element: string, attribute: string, ordinal: number, reference: string, target: URL, kind: 'portal' | 'posting'): Witness => ({ element, attribute, ordinal,
    referenceHash: digestBytes(reference), resolvedReferenceHash: digestBytes(target.toString()), queryKeys: [...new Set(target.searchParams.keys())].sort(), reference: kind });
  let posting: Witness | undefined;
  $('a[href],iframe[src]').each((ordinal, node) => {
    const element = $(node);
    if (witness || element.is('iframe[srcdoc]') || element.is('a[download]')) return;
    const attribute = node.tagName === 'a' ? 'href' : 'src';
    const reference = element.attr(attribute)!;
    let target: URL; try { target = new URL(reference, base); } catch { return; }
    if (portal.matches(target.toString())) witness = witnessFor(node.tagName, attribute, ordinal, reference, target, 'portal');
    else if (!posting && portal.matchesPosting(target.toString())) posting = witnessFor(node.tagName, attribute, ordinal, reference, target, 'posting');
  });
  for (const embed of embeds) {
    if (witness) break;
    let target: URL; try { target = new URL(embed.reference, base); } catch { continue; }
    if (portal.matches(target.toString())) witness = witnessFor('script', 'src', embed.ordinal, embed.reference, target, 'portal');
  }
  // A link to one of the portal's own postings designates the same tenant; the exact listing reference wins when both exist.
  witness ??= posting;
  if (!witness) return unproven('EXACT_PORTAL_REFERENCE_NOT_FOUND');
  const current = await readIdentitySource(db, key);
  if (current?.currentRevisionId !== source.currentRevisionId) return unproven('SOURCE_CHANGED_DURING_INSPECTION');
  return { ...archived, verdict: 'LINK_MATCHED' as const, reason: null, configuredPortal: portal.url, witness,
    ...(canonical ? { canonicalPortal: auditUrl(evidence.finalUrl), redirectChain: evidence.responses.map(row => ({ url: row.requestUrl, status: row.status })) } : {}) };
}
