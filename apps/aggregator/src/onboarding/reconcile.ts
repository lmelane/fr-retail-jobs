/**
 * LE RAPPROCHEMENT D'UN DOSSIER AVEC LE CATALOGUE — ce qui se décide AVANT toute intégration.
 *
 * Le défaut que ce module empêche est mesuré, pas théorique : à la vague 2 de P9, cinq dossiers sur douze
 * n'étaient pas des lacunes — trois marques Calzedonia étaient déjà servies par le portail de groupe
 * `oniverse`, et leur créer une source par marque aurait dupliqué un portail déjà catalogué (cas D34).
 *
 * Et la couverture par un groupe ne se lit PAS seulement sur les sociétés créditées : mesuré ici, `oniverse`
 * publie 524 offres sous la seule société « ONIVERSE » — ses marques n'y sont créditées nulle part. Sur ce
 * seul signal, un dossier « CALZEDONIA » passerait pour une lacune. *Un portail de groupe couvre ses
 * marques, que nous sachions déjà les nommer ou non* — d'où le second signal, le `portalScope` revu.
 *
 * Cinq recouvrements distincts, parce qu'ils n'appellent pas la même décision :
 *
 *   acteur déjà couvert          il publie déjà des offres par une source à lui
 *   marque couverte par un groupe le portail du groupe la sert déjà — créer une source la dupliquerait
 *   portail régional existant     une source du même acteur existe sur un autre pays
 *   source déjà présente          l'URL mène à un portail déjà catalogué
 *   doublon de tenant             deux clés résoudraient le même board (contrainte d'unicité)
 *
 * *Un recouvrement n'est jamais un échec du dossier : c'est une information qui évite un doublon.*
 */

/** Ce que le catalogue sait, lu une fois et passé ici — le module ne parle pas à la base. */
export type CatalogueView = {
  /** Clés de source existantes, par `tenantKey` normalisé. */
  readonly tenantsByKey: ReadonlyMap<string, string>;
  /** Domaines de portail déjà catalogués → clé de source. */
  readonly sourcesByDomain: ReadonlyMap<string, string>;
  /** Sociétés publiant au moins une offre active → nombre d'offres. */
  readonly companiesWithOffers: ReadonlyMap<string, number>;
  /** Société → clés de sources actives qui la créditent. */
  readonly sourcesByCompany: ReadonlyMap<string, readonly string[]>;
  /** Marque → portail de groupe qui la sert déjà (le cas D34). */
  readonly brandCoveredByGroup: ReadonlyMap<string, string>;
};

export type Dossier = {
  readonly acteur: string;
  readonly type: 'MAISON' | 'ENSEIGNE' | 'GROUPE' | 'PORTAIL_REGIONAL' | 'SOURCE_SUPPLEMENTAIRE';
  readonly urlOfficielle: string;
  readonly groupe?: string | null;
  readonly pays?: string | null;
  readonly secteur?: string | null;
  readonly portalScope?: 'SINGLE_BRAND' | 'MULTI_BRAND';
};

export const ONBOARD_VERDICTS = [
  'READY_CONFIG_ONLY',
  'READY_PUBLIC_HTML',
  'ALREADY_COVERED_BY_GROUP',
  'ALREADY_COVERED_BY_SOURCE',
  'REGIONAL_SOURCE_CANDIDATE',
  'IDENTITY_AMBIGUOUS',
  'OFFICIAL_PORTAL_NOT_PROVEN',
  'NEW_ADAPTER_REQUIRED',
  'OUT_OF_SECTOR',
  'BLOCKED_TECHNICAL',
  'INTEGRATED',
] as const;
export type OnboardVerdict = (typeof ONBOARD_VERDICTS)[number];

export type Overlap = {
  readonly kind:
    | 'ACTEUR_DEJA_COUVERT' | 'MARQUE_COUVERTE_PAR_GROUPE' | 'PORTAIL_REGIONAL_EXISTANT'
    | 'SOURCE_DEJA_PRESENTE' | 'DOUBLON_DE_TENANT';
  readonly detail: string;
  /** Un recouvrement BLOQUANT interdit la création ; sinon il informe la décision. */
  readonly blocking: boolean;
};

/** Normalise un libellé d'acteur pour le rapprochement — casse et ponctuation ne sont pas une identité. */
export function normalizeActor(name: string): string {
  return name.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/\b(inc|llc|ltd|limited|sa|sas|sasu|gmbh|bv|nv|spa|srl|plc|co|corp|corporation|group|groupe)\b/g, '')
    .replace(/[^a-z0-9]+/g, ' ').trim();
}

/** Le domaine enregistrable, pour rapprocher deux URLs d'un même portail. */
export function registrableDomain(url: string): string | null {
  try {
    const h = new URL(url).hostname.toLowerCase().replace(/^www\./, '');
    const parts = h.split('.');
    return parts.length <= 2 ? h : parts.slice(-2).join('.');
  } catch { return null; }
}

/**
 * Détecte les recouvrements. Ne décide pas seul du verdict : il fournit les faits qui le déterminent.
 */
export function findOverlaps(d: Dossier, cat: CatalogueView): Overlap[] {
  const out: Overlap[] = [];
  const actor = normalizeActor(d.acteur);
  const domain = registrableDomain(d.urlOfficielle);

  /**
   * 1. Le portail lui-même est-il déjà catalogué ?
   *
   * Le blocage ne vaut PAS pour un dossier qui annonce un portail régional ou une source supplémentaire :
   * `careers.skechers.com/fr/fr` et `careers.skechers.com/us/en` partagent le domaine enregistrable mais ne
   * servent pas le même périmètre. Bloquer sur le domaine y interdirait toute extension régionale d'un
   * acteur déjà présent — soit précisément la catégorie que le lot doit démontrer.
   *
   * La garde qui reste, et qui est la bonne, est le **doublon de tenant** : deux configurations qui
   * résolvent le même board sont refusées avant écriture, quel que soit le type du dossier.
   */
  const supplementaire = d.type === 'PORTAIL_REGIONAL' || d.type === 'SOURCE_SUPPLEMENTAIRE';
  if (domain && cat.sourcesByDomain.has(domain)) {
    out.push({
      kind: supplementaire ? 'PORTAIL_REGIONAL_EXISTANT' : 'SOURCE_DEJA_PRESENTE',
      blocking: !supplementaire,
      detail: `le domaine ${domain} est déjà servi par la source « ${cat.sourcesByDomain.get(domain)} »`
        + (supplementaire ? ' — le dossier annonce un périmètre distinct, à prouver à la validation' : ''),
    });
  }

  // 2. La marque est-elle déjà servie par un portail de GROUPE ? — le cas D34, le plus coûteux.
  const group = cat.brandCoveredByGroup.get(actor);
  if (group) {
    out.push({ kind: 'MARQUE_COUVERTE_PAR_GROUPE', blocking: true,
      detail: `« ${d.acteur} » est déjà collectée par le portail de groupe « ${group} » — ` +
              `créer une source par marque dupliquerait ses offres (D34)` });
  }

  // 3. L'acteur publie-t-il déjà, par une source à lui ?
  const offers = cat.companiesWithOffers.get(actor);
  const existing = cat.sourcesByCompany.get(actor) ?? [];
  if (offers && existing.length) {
    /**
     * Publier déjà n'interdit pas une source SUPPLÉMENTAIRE : un portail régional ou un second board
     * officiel complètent une couverture sans la dupliquer. Le blocage ne vaut que si le dossier prétend
     * introduire un acteur nouveau.
     */
    out.push({
      kind: supplementaire ? 'PORTAIL_REGIONAL_EXISTANT' : 'ACTEUR_DEJA_COUVERT',
      blocking: !supplementaire,
      detail: `« ${d.acteur} » publie déjà ${offers} offres via ${existing.length} source(s) : ${existing.join(', ')}`,
    });
  }

  return out;
}

/** Le tenant qu'une configuration produirait, pour détecter un doublon AVANT d'écrire. */
export function tenantCollision(tenantKey: string, cat: CatalogueView): Overlap | null {
  const existing = cat.tenantsByKey.get(tenantKey);
  return existing
    ? { kind: 'DOUBLON_DE_TENANT', blocking: true,
        detail: `le tenant ${tenantKey} est déjà porté par la source « ${existing} »` }
    : null;
}

export type VerdictInput = {
  readonly dossier: Dossier;
  readonly overlaps: readonly Overlap[];
  /** L'ATS reconnu, s'il l'est. `null` = protocole non identifié. */
  readonly ats: string | null;
  /** Un adaptateur existe-t-il pour cet ATS ? */
  readonly adapterExists: boolean;
  /** La page officielle a-t-elle été archivée et nomme-t-elle le board configuré ? (D60) */
  readonly portalProven: boolean;
  /** Le secteur est-il dans le périmètre ? `null` = non tranché. */
  readonly inSector: boolean | null;
  /** L'identité de l'acteur est-elle ambiguë (homonyme, libellé trop court) ? */
  readonly identityAmbiguous: boolean;
  /** Un blocage technique nommé (WAF, rendu impossible…). */
  readonly technicalBlocker?: string | null;
};

/**
 * Le verdict d'un dossier. L'ordre des tests suit ce qui DISQUALIFIE le plus tôt :
 * un dossier hors secteur ne mérite pas qu'on prouve son portail.
 */
export function decideVerdict(i: VerdictInput): { verdict: OnboardVerdict; reason: string } {
  if (i.inSector === false) {
    return { verdict: 'OUT_OF_SECTOR', reason: 'acteur hors du périmètre sectoriel' };
  }

  // Les recouvrements bloquants priment sur tout le reste : intégrer créerait un doublon.
  const blocking = i.overlaps.find((o) => o.blocking);
  if (blocking) {
    const verdict: OnboardVerdict =
      blocking.kind === 'MARQUE_COUVERTE_PAR_GROUPE' ? 'ALREADY_COVERED_BY_GROUP' : 'ALREADY_COVERED_BY_SOURCE';
    return { verdict, reason: blocking.detail };
  }

  if (i.identityAmbiguous) {
    return { verdict: 'IDENTITY_AMBIGUOUS', reason: 'identité de l\'acteur non tranchée (homonyme ou libellé ambigu)' };
  }
  if (i.technicalBlocker) {
    return { verdict: 'BLOCKED_TECHNICAL', reason: i.technicalBlocker };
  }
  if (!i.portalProven) {
    // D60 : le domaine est un indicateur, la preuve est une page officielle archivée qui NOMME le board.
    return { verdict: 'OFFICIAL_PORTAL_NOT_PROVEN', reason: 'aucune page officielle archivée ne nomme le board configuré' };
  }
  if (i.ats && !i.adapterExists) {
    return { verdict: 'NEW_ADAPTER_REQUIRED', reason: `famille ATS « ${i.ats} » non supportée par un adaptateur existant` };
  }

  const regional = i.overlaps.find((o) => o.kind === 'PORTAIL_REGIONAL_EXISTANT');
  if (regional) {
    return { verdict: 'REGIONAL_SOURCE_CANDIDATE', reason: regional.detail };
  }

  /**
   * Un ATS reconnu avec adaptateur = configuration seule. C'est la propriété que le lot doit démontrer :
   * une nouvelle Maison sur une famille maîtrisée n'est jamais un nouveau script.
   */
  return i.ats
    ? { verdict: 'READY_CONFIG_ONLY', reason: `ATS « ${i.ats} » maîtrisé : intégration par configuration et preuve` }
    : { verdict: 'READY_PUBLIC_HTML', reason: 'portail propriétaire : adaptateur générique HTML/JS' };
}
