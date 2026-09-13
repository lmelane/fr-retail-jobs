/**
 * LA RÉFÉRENCE DU BOARD — ce que la page officielle doit NOMMER, dérivé de la configuration réelle.
 *
 * D60 : « la certification exige que la page officielle archivée nomme le board **configuré** (référence
 * dérivée de la configuration par type d'ATS, jamais un mot libre) ».
 *
 * Le « jamais un mot libre » est l'essentiel. Si l'opérateur saisissait la chaîne à chercher, il pourrait —
 * de bonne foi — chercher le nom de la Maison et le trouver sur sa propre page officielle : la preuve serait
 * circulaire et n'établirait rien sur le board. En dérivant la référence de la configuration, on ne peut
 * prouver que ce qu'on appelle réellement.
 *
 * Les deux cas de la vague 1 montrent l'écart que cela couvre :
 *   · `kult-olymp-hades` → `jpweltersgorgensgmbhcobekleidungskg` (l'entité juridique, pas la Maison) ;
 *   · `oak-essentials`  → `jennikayne` (une autre marque du groupe).
 */

/**
 * La chaîne que la page officielle doit contenir pour rattacher le board configuré.
 *
 * Pour un hôte dédié, c'est l'hôte lui-même. Pour un ATS mutualisé, c'est l'identifiant du tenant : c'est lui
 * qui distingue une Maison d'une autre sur `boards.greenhouse.io` ou `api.smartrecruiters.com`.
 */
export function boardReferenceFor(kind: string, config: Record<string, unknown>): string {
  const str = (k: string) => (typeof config[k] === 'string' ? String(config[k]).trim() : '');
  const host = (value: string) => { try { return new URL(value).hostname; } catch { return value; } };

  switch (kind) {
    case 'greenhouse': return str('board');
    case 'lever': return str('site');
    case 'smartrecruiters': case 'smartrecruiters-whitelabel': return str('company');
    case 'recruitee': return str('subdomain');
    case 'teamtailor': return str('subdomain') || host(str('jobs_url') || str('origin'));
    case 'workday': return str('tenant') || host(str('origin'));
    case 'digitalrecruiters': return str('domainName') || str('domain');
    default: {
      // Hôte dédié : l'origine configurée est elle-même la référence. Un portail sur le domaine de la Maison
      // se prouve alors par sa propre mention sur le site — ce qui reste une preuve, pas une tautologie :
      // la page doit nommer l'hôte du portail, pas seulement exister.
      const candidate = str('origin') || str('listingUrl') || str('jobs_url') || str('sitemapUrl')
        || str('careers_url') || str('domainName') || str('domain');
      if (!candidate) throw new Error(`${kind}: aucune référence de board dérivable de la configuration`);
      return host(candidate);
    }
  }
}
