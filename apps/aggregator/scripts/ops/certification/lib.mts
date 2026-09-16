import { readFileSync } from 'node:fs';

/**
 * LE DOSSIER DE PREUVES est une ENTRÉE, jamais une constante.
 *
 * Le code exécutable indispensable est versionné ici ; les preuves — dumps, pages officielles archivées,
 * specs d'exécution, manifestes, résultats — restent hors dépôt, sous `backups/`. Coder le chemin en dur
 * remettrait la seule copie exécutable au même endroit que ses données, ce que les lots précédents ont
 * justement interdit.
 *
 * `CERTIFICATION_EVIDENCE_DIR` permet donc de pointer un autre jeu de preuves — une répétition, un autre lot —
 * sans dupliquer une ligne de code. Le défaut reste le dossier historique, pour que rien ne casse.
 */
export const ROOT = process.env.CERTIFICATION_EVIDENCE_DIR ?? 'backups/lot4-20260909';

/** One B6 candidate: identity proof page archived by the portal research, portal, perimeter, sector. */
export type B6Spec = { sourceRevisionId?: string; key: string; maison: string; kind: string; tier: string; config: Record<string, unknown>; careersDomain?: string; proofSha: string; proofUrl: string; portalUrl: string; officialDomain: string; portalScope: 'SINGLE_BRAND' | 'MULTI_BRAND'; sector?: string; statement: string; mustContain?: string };

/** b6-specs.json plus the first B6 source (Arc'teryx), integrated by its own script before the spec file existed. */
export function loadSpecs(): B6Spec[] {
  const specs: B6Spec[] = JSON.parse(readFileSync(`${ROOT}/b6-specs.json`, 'utf8'));
  if (!specs.some((s) => s.key === 'arcteryx')) specs.push({
    key: 'arcteryx', maison: "Arc'teryx", kind: 'lever', tier: 'EMPLOYER_DIRECT', config: { site: 'arcteryx.com' }, careersDomain: 'jobs.lever.co',
    proofSha: 'a74d2d3fe428abb8dd45cd101d916d237c63b46a36ed6da8460c9bcaa227af73', proofUrl: 'https://arcteryx.com/fr/fr/careers/retail-opportunities', portalUrl: 'https://jobs.lever.co/arcteryx.com',
    officialDomain: 'arcteryx.com', portalScope: 'SINGLE_BRAND', sector: 'OUTDOOR_APPAREL', statement: "arcteryx.com/fr/fr/careers/retail-opportunities links the Lever board jobs.lever.co/arcteryx.com; one native employer label, ARC'TERYX → SINGLE_BRAND.",
  });
  return specs;
}

/** The exact references under which the configured board can appear on the official page — derived from the config, never a free string. */
export function portalReferences(kind: string, config: Record<string, unknown>): RegExp[] {
  const s = (k: string) => (typeof config[k] === 'string' ? String(config[k]) : '');
  const esc = (x: string) => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  switch (kind) {
    case 'greenhouse': return [new RegExp(`(?:job-boards|boards|boards-api)\\.greenhouse\\.io/(?:v1/boards/|embed/job_board\\?for=)?${esc(s('board'))}(?![a-z0-9_-])`, 'i'), new RegExp(`greenhouse\\.io[^"'\\s]*[?&]for=${esc(s('board'))}(?![a-z0-9_-])`, 'i')];
    case 'lever': return [new RegExp(`jobs\\.(?:eu\\.)?lever\\.co/${esc(s('site'))}(?![a-z0-9_.-])`, 'i')];
    case 'workday': { const host = new URL(s('origin')).hostname; return [new RegExp(`${esc(host)}/(?:[a-z]{2}-[a-z]{2}/)?${esc(s('site'))}(?![a-z0-9_-])`, 'i')]; }
    case 'teamtailor': return [new RegExp(esc(new URL(s('jobs_url') || s('origin') || `https://${s('subdomain')}.teamtailor.com`).hostname), 'i')];
    case 'digitalrecruiters': return [new RegExp(esc(s('domainName') || s('domain')), 'i')];
    case 'flatchr': { const url = new URL(s('listingUrl')); return [new RegExp(esc(url.hostname + url.pathname.replace(/\/$/, '')), 'i')]; }
    default: { const origin = s('origin') || s('listingUrl') || s('jobs_url') || s('careers_url'); if (!origin) throw Error(`${kind}: no portal reference derivable from the configuration`); return [new RegExp(esc(new URL(origin).hostname), 'i')]; }
  }
}

/** The archived official page of a spec, verified against its hash. */
export function archivedPage(spec: B6Spec): { buffer: Buffer; text: string } {
  const buffer = readFileSync(`${ROOT}/portal-research/artifacts/${spec.proofSha}.txt`);
  return { buffer, text: buffer.toString('utf8') };
}
