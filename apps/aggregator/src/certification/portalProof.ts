/**
 * LA PREUVE DE PORTAIL — établir qu'une page officielle DÉSIGNE le board configuré.
 *
 * Le contrat D60 n'accepte pas qu'un portail soit certifié parce que son domaine ressemble à celui de la
 * Maison. Il exige une page officielle **archivée et hachée** dans laquelle apparaît la référence du board
 * réellement configuré.
 *
 * La vague 1 de P9 a montré pourquoi, sur des cas réels :
 *   · `kult-olymp-hades` (domaine `kult-olymp-hades.de`) appelle en fait
 *     `jpweltersgorgensgmbhcobekleidungskg.recruitee.com` — une entité juridique ;
 *   · `oak-essentials` (domaine `oakessentials.com`) appelle le board Greenhouse `jennikayne` — une autre
 *     marque du même groupe.
 *
 * **Aucune comparaison de domaines enregistrables n'aurait rapproché ces tenants de leur Maison.** Seule la
 * page officielle peut le faire — ou refuser de le faire, ce qui est tout aussi utile.
 *
 * Ce module NE télécharge rien : il décide, sur une page déjà récupérée. La séparation permet de tester la
 * décision sans réseau, et empêche qu'un chemin d'appel invente sa propre règle de concordance.
 */
import { createHash } from 'node:crypto';

/** Le verdict d'un dossier de preuve. Trois états, jamais un booléen : « pas prouvé » ≠ « réfuté ». */
export type ProofVerdict = 'PROVEN' | 'REFUTED' | 'UNVERIFIABLE';

export type ProofInput = {
  /** L'URL demandée, avant redirections. */
  requestedUrl: string;
  /** L'URL réellement atteinte. Une redirection hors du domaine officiel change la nature de la preuve. */
  finalUrl: string;
  httpStatus: number;
  /** Le corps récupéré, tel quel. */
  body: string;
  /** Le domaine officiel de la Maison, attendu comme hôte de la page de preuve. */
  officialDomain: string;
  /**
   * La référence du board REELLEMENT configurée — dérivée de la configuration par type d'ATS, jamais un mot
   * libre. C'est elle qui doit apparaître dans la page.
   */
  mustContain: string;
};

export type ProofRecord = {
  verdict: ProofVerdict;
  reason: string;
  requestedUrl: string;
  finalUrl: string;
  httpStatus: number;
  sha256: string | null;
  bytes: number;
  /** L'extrait exact où la référence apparaît — une preuve doit se relire, pas se croire. */
  excerpt: string | null;
  collectedAt: string;
};

/** Le hachage de ce qui a été réellement archivé. */
export function sha256Of(body: string): string {
  return createHash('sha256').update(body, 'utf8').digest('hex');
}

/** L'hôte de `url` appartient-il au domaine officiel (lui-même ou un sous-domaine) ? */
export function isOnOfficialDomain(url: string, officialDomain: string): boolean {
  try {
    const host = new URL(url).hostname.toLowerCase().replace(/^www\./, '');
    const domain = officialDomain.toLowerCase().replace(/^www\./, '');
    return host === domain || host.endsWith(`.${domain}`);
  } catch { return false; }
}

/** L'extrait autour de la première occurrence, pour qu'un relecteur voie le contexte. */
export function excerptAround(body: string, needle: string, span = 120): string | null {
  const i = body.toLowerCase().indexOf(needle.toLowerCase());
  if (i < 0) return null;
  return body.slice(Math.max(0, i - span), Math.min(body.length, i + needle.length + span))
    .replace(/\s+/g, ' ').trim();
}

/**
 * Le verdict, fail-closed : tout ce qui n'est pas une concordance démontrée sur une page officielle lisible
 * laisse la source non prouvée.
 *
 * `UNVERIFIABLE` et `REFUTED` sont distincts et le restent : une page qu'on n'a pas pu lire n'a rien réfuté,
 * et confondre les deux ferait abandonner une Maison pour une panne réseau.
 */
export function portalProof(input: ProofInput): ProofRecord {
  const collectedAt = new Date().toISOString();
  const base = {
    requestedUrl: input.requestedUrl, finalUrl: input.finalUrl, httpStatus: input.httpStatus,
    bytes: Buffer.byteLength(input.body, 'utf8'), collectedAt,
  };

  if (input.httpStatus < 200 || input.httpStatus >= 300) {
    return { ...base, verdict: 'UNVERIFIABLE', reason: `page officielle non lue : HTTP ${input.httpStatus}`, sha256: null, excerpt: null };
  }
  if (!input.body.trim()) {
    return { ...base, verdict: 'UNVERIFIABLE', reason: 'page officielle vide', sha256: null, excerpt: null };
  }

  const sha256 = sha256Of(input.body);

  // La page doit appartenir au domaine officiel APRÈS redirections : une redirection vers un hôte tiers ne
  // prouve plus rien sur ce que la Maison publie.
  if (!isOnOfficialDomain(input.finalUrl, input.officialDomain)) {
    return { ...base, sha256, excerpt: null, verdict: 'REFUTED',
      reason: `l'URL finale ${input.finalUrl} n'appartient pas au domaine officiel ${input.officialDomain}` };
  }

  const excerpt = excerptAround(input.body, input.mustContain);
  if (!excerpt) {
    return { ...base, sha256, excerpt: null, verdict: 'REFUTED',
      reason: `la page officielle ne nomme pas le board configuré « ${input.mustContain} »` };
  }

  return { ...base, sha256, excerpt, verdict: 'PROVEN',
    reason: `la page officielle nomme le board configuré « ${input.mustContain} »` };
}
