/**
 * WORKPLACE TYPE — le MODE DE TRAVAIL, dimension mondiale.
 *
 * Remplace la colonne `remote`, qui portait le vocabulaire PROPRIÉTAIRE d'une
 * source (`punctual`, `fulltime`, `unknown` — l'échelle de Welcome to the
 * Jungle) directement dans le modèle mondial, et stockait « unknown » comme une
 * VALEUR sur 648 offres alors que c'est un vide.
 *
 * Mesuré le 2026-09-08 sur 71 629 offres : 95,3 % de la colonne était nulle, et
 * `full` — le vrai télétravail — ne concernait que 70 offres. Le gisement
 * récupérable plafonne à ~4,3 % du catalogue. **Ce n'est pas une raison pour
 * garder un champ mal défini** : le faible volume décide de ce qu'on EXPOSE,
 * pas de la propreté du modèle (règle Loïc).
 *
 * RÈGLE ABSOLUE : `absence de preuve ≠ ONSITE`. `null` signifie « ModeCareers
 * ne dispose pas d'une preuve suffisante », jamais « le poste est sur site ».
 */

export const WORKPLACE_TYPES = ['ONSITE', 'HYBRID', 'REMOTE'] as const;
export type WorkplaceType = (typeof WORKPLACE_TYPES)[number];

/** Une preuve déclarée par la source, ou déduite par nous. */
export type WorkplaceEvidence = 'EXPLICIT' | 'INFERRED';

export type WorkplaceReading = {
  type: WorkplaceType;
  evidence: WorkplaceEvidence;
};

function upper(raw: string): string {
  return raw
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toUpperCase();
}

/**
 * Le vocabulaire des sources, mesuré en base — pas une liste imaginée.
 *
 * Multilingue par construction : `custOnsiteRemote` sert « Híbrido » (espagnol)
 * et « Hybryda » (polonais) ; une liste anglaise seule aurait manqué ces cas.
 * La langue de la source ne change jamais le concept canonique.
 *
 * L'ordre compte : REMOTE et HYBRID avant ONSITE, car « hybrid » contient
 * souvent aussi une mention de bureau.
 */
const EXPLICIT_PATTERNS: ReadonlyArray<readonly [WorkplaceType, RegExp]> = [
  /**
   * HYBRID d'abord : « hybrid remote » et « remote hybrid » existent, et le
   * mot le plus précis doit gagner. « X jours au bureau » est la formulation
   * la plus courante en clair (903 descriptions mesurées).
   */
  [
    'HYBRID',
    /\bHYBRID\b|\bHYBRIDE\b|HIBRIDO|HYBRYDA|IBRIDO|TELETRAVAIL PARTIEL|\bPARTIAL\b|\bPARTIEL\b|\bMIXTE\b/,
  ],
  [
    'REMOTE',
    /\bREMOTE\b|\bFULL[ _-]?REMOTE\b|\bFULLTIME\b|TELETRAVAIL TOTAL|100\s?% TELETRAVAIL|WORK FROM HOME|HOME[ _-]?BASED|TELECOMMUT|SMART ?WORKING|\bTELETRABAJO\b/,
  ],
  /**
   * `punctual` (WTTJ) = « Télétravail PONCTUEL autorisé » — vérifié dans la
   * documentation officielle de l'API. Décision Loïc : c'est un poste SUR SITE
   * avec une tolérance occasionnelle, pas un rythme hybride. Le classer HYBRID
   * promettrait au candidat des jours télétravaillés garantis qui n'existent
   * pas. La valeur brute reste conservée dans l'enrichment.
   */
  [
    'ONSITE',
    /\bON[ _-]?SITE\b|\bONSITE\b|SUR SITE|\bPUNCTUAL\b|TELETRAVAIL PONCTUEL|PRESENTIEL|\bNO REMOTE\b|PAS DE TELETRAVAIL/,
  ],
];

/**
 * Les valeurs de champ qui NIENT le télétravail — booléens et libellés courts.
 *
 * Traitées à part des motifs textuels : « false » ou « no » ne veulent rien
 * dire hors du contexte de leur clé, et cherchés dans un texte libre ils
 * produiraient des absurdités.
 */
const NEGATIVE_FIELD = /^(NO|FALSE|0|NON|NEIN|NIE)$/;
const POSITIVE_FIELD = /^(YES|TRUE|1|OUI|JA)$/;

/**
 * Lit une valeur de CHAMP (structuré) vers le mode de travail canonique.
 *
 * `fieldName` porte le sens du booléen : `has_remote: true` dit REMOTE,
 * `on_site: true` dit ONSITE, `telecommuting: false` dit ONSITE. Sans le nom du
 * champ, « true » est ininterprétable — c'est pourquoi il est obligatoire.
 */
export function readWorkplaceField(fieldName: string, raw?: string | null): WorkplaceReading | undefined {
  if (raw === undefined || raw === null) return undefined;
  const value = upper(String(raw).trim().replace(/^\["?|"?\]$/g, ''));
  if (!value) return undefined;

  const key = upper(fieldName);

  // Un booléen ne se lit qu'avec le sens de sa clé.
  if (NEGATIVE_FIELD.test(value) || POSITIVE_FIELD.test(value)) {
    const positive = POSITIVE_FIELD.test(value);
    /**
     * `has_remote` est EXCLU : mesuré le 2026-09-08, il vaut `true` sur 100 %
     * des lignes WTTJ — y compris quand `remote: no`. C'est un marqueur de
     * présence du champ, pas une information de télétravail. Le lire aurait
     * faussement classé 873 offres, dont 396 explicitement « non autorisé ».
     */
    if (/HAS_?REMOTE/.test(key)) return undefined;
    if (/IS_?REMOTE|\bREMOTE\b|TELECOMMUT/.test(key)) {
      return positive ? { type: 'REMOTE', evidence: 'EXPLICIT' } : { type: 'ONSITE', evidence: 'EXPLICIT' };
    }
    if (/ON_?SITE|ONSITE/.test(key)) {
      // `on_site: false` ne dit PAS où l'on travaille : seulement que ce n'est
      // pas exclusivement sur site. On refuse d'inventer HYBRID ou REMOTE.
      return positive ? { type: 'ONSITE', evidence: 'EXPLICIT' } : undefined;
    }
    if (/HYBRID/.test(key)) {
      return positive ? { type: 'HYBRID', evidence: 'EXPLICIT' } : undefined;
    }
    return undefined;
  }

  for (const [type, pattern] of EXPLICIT_PATTERNS) {
    if (pattern.test(value)) return { type, evidence: 'EXPLICIT' };
  }
  return undefined;
}

/**
 * Lit un TEXTE LIBRE (titre ou description) vers le mode de travail.
 *
 * Les recherches texte servent à TROUVER des candidats, jamais à écrire
 * aveuglément : « remote » qualifie souvent autre chose que le poste — une
 * équipe distante, des boutiques à distance, un outil. Les faux positifs
 * mesurés sont écartés explicitement.
 */
const FALSE_POSITIVE =
  /REMOTE (CONTROL|TEAM|TEAMS|COLLABORATION|STORES?|SITES?|LOCATIONS?|DESKTOP|ACCESS|SUPPORT TOOL|MONITORING|SENSING)|SUPPORT REMOTE|MANAGE REMOTE|HYBRID (CLOUD|CAR|VEHICLE|FIBER|MATERIAL|APPROACH TO DATA)/;

export function readWorkplaceText(raw?: string | null): WorkplaceReading | undefined {
  if (!raw) return undefined;
  const value = upper(raw);
  if (FALSE_POSITIVE.test(value)) return undefined;

  for (const [type, pattern] of EXPLICIT_PATTERNS) {
    if (pattern.test(value)) return { type, evidence: 'EXPLICIT' };
  }

  /**
   * L'INFÉRENCE : « 3 jours au bureau », « 2 days per week in the office ».
   * Le mode n'est pas nommé, il se déduit d'un rythme — donc une preuve d'une
   * autorité moindre, exactement comme « 21h » pour le temps de travail.
   */
  if (/\b[1-4]\s?(JOURS?|DAYS?)\b[^.]{0,30}(BUREAU|OFFICE|SITE)/.test(value)) {
    return { type: 'HYBRID', evidence: 'INFERRED' };
  }
  return undefined;
}

/**
 * La RESTRICTION GÉOGRAPHIQUE du télétravail, conservée telle quelle.
 *
 * Mesurée en base : « Remote USA », « Central US », « Southern England »,
 * « Remote, NJ License Required », « PST/MT/CST only », `flexible_within_country`.
 *
 * Décision Loïc (2026-09-08) : en v1 on CONSERVE la trace sans construire la
 * taxonomie — pas de colonne, pas d'index, pas de facette pour quelques
 * centaines de cas. On accumule proprement, on promeut quand le volume le
 * justifiera. D'où un simple libellé brut, non découpé.
 */
export function readWorkplaceRestriction(raw?: string | null): string | undefined {
  if (!raw) return undefined;
  const value = String(raw);
  const m = value.match(
    // `i` sur le mot « remote » seulement : la CASSE du lieu reste
    // significative — un nom propre commence par une majuscule, ce qui écarte
    // « remote work » ou « remote role » sans liste d'exclusions exhaustive.
    /\bremote\b\s*(?:[,\-–—:(]\s*)?((?:within|in|only in|based in|must reside in)\s+)?([A-ZÀ-Ÿ][\w.'’-]*(?:\s+[A-ZÀ-Ÿ][\w.'’-]*){0,4})/i,
  );
  if (m?.[2]) {
    const found = `${m[1] ?? ''}${m[2]}`.trim().replace(/\s+/g, ' ');
    // « Remote Role », « Remote Work » ne sont pas des lieux.
    if (/^(role|work|position|job|opportunit)/i.test(found)) return undefined;
    return found;
  }
  /**
   * `flexible_within_country` (Estée Lauder) a été ÉCARTÉ : le dry-run l'a
   * trouvé sur des postes en BOUTIQUE (« Beauty Advisor - Multibrand »,
   * « SAINT LAURENT Client Advisor - Wuhan SKP »). Son nom promettait une
   * restriction de télétravail, son contenu ne la porte pas.
   */
  return undefined;
}

/**
 * LA DESCRIPTION — la preuve de dernier recours, et la plus risquée.
 *
 * Elle pesait 70 % des décisions de la première version : sur 6 665 offres où
 * un mot apparaissait, l'audit du 2026-09-08 n'a trouvé que ~1 300 ASSERTIONS
 * réelles. Les 5 361 autres étaient des mentions incidentes — « managing hybrid
 * technology landscapes », « #LI-Remote » (un tag LinkedIn), « possibility of
 * remote working » (un avantage listé, pas le régime du poste).
 *
 * D'où la règle (Loïc) : la description n'écrit que si elle AFFIRME quelque
 * chose sur l'organisation du travail DE CETTE OFFRE. La simple présence du mot
 * ne suffit jamais. Les règles sont génériques et multilingues — jamais
 * indexées sur une source ou une marque.
 */

/** Une négation inverse le sens : « this role is NOT available as remote ». */
const DESCRIPTION_NEGATION =
  /\b(?:not|no longer|n'est pas|nest pas|pas)\b[^.]{0,30}\b(?:remote|t[ée]l[ée]travail|hybrid)/i;

/**
 * Les ASSERTIONS retenues après audit, dans l'ordre de spécificité.
 *
 * ONSITE avant HYBRID : « located on-site in our office » est net, alors qu'une
 * description hybride mentionne presque toujours aussi le bureau.
 */
const DESCRIPTION_ASSERTIONS: ReadonlyArray<readonly [WorkplaceType, RegExp]> = [
  [
    'ONSITE',
    /\b(?:this (?:is an?|role is|position is))\b[^.]{0,30}\bon[- ]?site\b|\bon[- ]?site (?:position|role|only)\b|\bposition is located on[- ]?site\b|\bposte (?:en|sur) (?:pr[ée]sentiel|site)\b|\b(?:aucun|pas de) t[ée]l[ée]travail\b|\bno remote work\b/i,
  ],
  [
    'HYBRID',
    /\bhybrid (?:role|position|schedule|work model|working model)\b|\bthis (?:is a|role is|position is)\b[^.]{0,20}\bhybri[dq]/i,
  ],
  /**
   * Le RYTHME chiffré : « 3 days in NYC office », « télétravail 2 jours par
   * semaine ». Formulation la plus fréquente et la moins ambiguë — elle décrit
   * une organisation, pas un sujet technique.
   */
  [
    'HYBRID',
    /\b[1-4]\s?(?:days?|jours?)\b[^.]{0,26}\b(?:office|bureau|site)\b|\bt[ée]l[ée]travail\b[^.]{0,20}\b[1-4]\s?jours?\b|\bhybrid\b\s*\([^)]{0,20}[1-4]\s?(?:days?|jours?)/i,
  ],
  [
    'REMOTE',
    /\b(?:fully|100\s?%|full)[- ]remote\b|\bremote (?:position|role|job|work opportunity)\b|\b(?:this (?:role|position) is)\b[^.]{0,20}\bremote\b|\bt[ée]l[ée]travail (?:total|complet|int[ée]gral)\b|\b100\s?% t[ée]l[ée]travail\b/i,
  ],
];

/**
 * Le mode de travail affirmé par une description, ou `undefined`.
 *
 * `undefined` est le cas NORMAL : la plupart des offres ne disent rien de leur
 * organisation, et `null` vaut mieux qu'un `workplaceType` inventé.
 */
export function readWorkplaceDescription(raw?: string | null): WorkplaceReading | undefined {
  if (!raw) return undefined;
  if (FALSE_POSITIVE.test(upper(raw))) return undefined;

  /**
   * INVARIANT : une négation est une preuve d'EXCLUSION, pas une valeur.
   *
   * « This role is NOT available as a remote position » interdit d'écrire
   * REMOTE — elle ne prouve PAS ONSITE, l'offre pouvant être hybride. Un
   * abandon global (le premier jet) effaçait aussi une assertion HYBRID
   * présente dans la même description.
   */
  const negatesRemote = DESCRIPTION_NEGATION.test(raw);

  for (const [type, pattern] of DESCRIPTION_ASSERTIONS) {
    if (!pattern.test(raw)) continue;
    if (type === 'REMOTE' && negatesRemote) continue;
    return { type, evidence: 'EXPLICIT' };
  }
  return undefined;
}
