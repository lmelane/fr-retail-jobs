import legacy from "./data/occupations-v1.json" with { type: "json" };
/** Pure, versioned occupation resolution. New rules are literal data. The
 * migrated regex compatibility layer is frozen until replaced by reviewed DSL
 * rules; a data publication cannot introduce arbitrary executable regex. */
export type Labels = Record<string, string>;
export type Definition = {
  key: string;
  labels: Labels;
  group?: string;
  family?: string;
  aliases?: string[];
  /** Alias de recherche qui ne valent que contre un titre (« Contrôle de gestion » : pas un secteur ni un service). */
  titleOnlyAliases?: string[];
  /** Libellés et alias lus DANS un intitulé plus long (`titleRoles`, D-475 point 38), chacun vérifié sur ce qu'il y
   * capte (étape de curation 6g, R-66 §2) ; tout autre alias ne vaut que pour l'intitulé exact. */
  titleReadingAliases?: string[];
  /** Ce qui empêche de lire le métier dans un intitulé (D-475 point 38) : les frontières des règles servies avec les
   * autres métiers (« adjoint », « deputy », « beauty ») et les décisions de la curation v3 (§32 a, §35, §37), sauf
   * « formation » et « training », que l'exemple de la décision montre faux (« Poste avec formation avant embauche »). */
  titleReadingExclusions?: string[];
  externalRefs?: string[];
};
export type Pattern = { pattern: string; flags?: string };
type PatternClause = Pattern & { field: "title" | "department" };
type PatternDecision = {
  id: string;
  key: string;
  all: PatternClause[];
  exclude?: PatternClause[];
};
export type Clause = {
  field: "title" | "department";
  any: string[];
  mode?: "phrase" | "exact";
};
export type OccupationRule = {
  id: string;
  occupation: string;
  all: Clause[];
  exclude?: Clause[];
  /** Explicit semantic precedence, reviewed in the release, never array order. */
  supersedes?: string[];
  specializations?: string[];
  evidence: string;
};
export type OccupationManifest = {
  schemaVersion: 1;
  /** Correspondance des intitulés : 1 (défaut, la version servie à l'octet près) ou 2 (lot 2B de D-475 : écritures
   * japonaise et thaïe, formes féminines, marques de genre et de contrat ignorées en mode exact). */
  matchingVersion?: 1 | 2;
  /** Présent quand le manifeste porte tout le vocabulaire de recherche (alias de l'API versés, lot 2B) : l'API n'y
   * ajoute plus rien. Absent (version servie v1) : l'API complète avec ses alias historiques. */
  searchVocabularyVersion?: string;
  /** Lecture des métiers dans un intitulé (`occupation-title-roles.ts`) : 1 (défaut, la lecture de la v3) ou 2 ([[D-500]]
   * Q5 : un mot au pluriel se lit au singulier quand le vocabulaire des métiers connaît ce singulier, et une expression
   * vérifiée vaut aussi à l'autre genre ; « Conseiller.e de ventes », « Vendeurs (f/h) », « Conseillère de vente »). */
  titleReadingVersion?: 1 | 2;
  id: string;
  review: { author: string; at: string; basis: string };
  groups: Definition[];
  families: Definition[];
  occupations: Definition[];
  familyRules: (Pattern & { id: string; key: string })[];
  departmentRules: (Pattern & { id: string; key: string })[];
  patterns: Record<string, Pattern>;
  rules: OccupationRule[];
  familyContexts: PatternDecision[];
  seniorityRules: PatternDecision[];
  seniorities: Definition[];
  specializations?: Definition[];
  familyPhraseRules?: {
    id: string;
    key: string | null;
    reason?: string;
    all: Clause[];
    exclude?: Clause[];
  }[];
  seniorityPhraseRules?: {
    id: string;
    key: string | null;
    reason?: string;
    all: Clause[];
    exclude?: Clause[];
  }[];
};

/** Orthography only. Keep the exact observed title outside this derived value. */
export function normalizeOccupationTitle(
  value: string | null | undefined,
): string {
  return orthography(value, 1);
}
/**
 * v1 retire toutes les marques combinantes ; v2 ne retire que les accents des écritures latine, grecque et cyrillique :
 * le dakuten japonais (« アドバイザー » n'est plus « アトハイサー ») et les voyelles thaïes restent.
 */
function orthography(value: string | null | undefined, version: 1 | 2): string {
  const decompose = (value ?? "").normalize("NFKD");
  return (version === 1
    ? decompose.replace(/\p{M}/gu, "")
    : decompose.replace(/([\p{Script=Latin}\p{Script=Greek}\p{Script=Cyrillic}])\p{M}+/gu, "$1").normalize("NFC"))
    .toUpperCase()
    .replace(/[’'`]/g, "'")
    .replace(/[∙·•]\s?(NE|IN|FE|E|ERE|RICE|TRICE|EUSE)\b/g, " $1")
    .replace(/[|/\\_+,;:()[\]{}<>«»"“”·•*]/g, " ")
    .replace(
      /(?<=[A-Z]{3})\.(?=(?:E|ERE|EUSE|RICE|TRICE|SE|IVE|NE|IENNE|ICE|EUR|EURE|ES|EUSES|ERES|FE|IN)\b)/g,
      " ",
    )
    .replace(/\s+/g, " ")
    .replace(
      /\b([A-Z]{3,}) (?:E|ERE|EUSE|RICE|TRICE|SE|IVE|NE|IENNE|ICE|EUR|EURE|ES|EUSES|ERES|FE|IN)\b(?=\s|$)/g,
      "$1",
    )
    .trim();
}
function phrase(value: string): string {
  return normalizeOccupationTitle(value)
    .replace(/\p{Script=Han}/gu, " $& ")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}
/**
 * Formes féminines ramenées à une forme commune, des deux côtés (intitulé et expression), mot à mot, sur les mots
 * latins d'au moins 6 lettres : français (repris de `masculiniser` du backend, plus « adjointe »), allemand (-erin,
 * -frau), espagnol, italien et portugais (-ora, -ada/-ado, -ata/-ato, -etta/-etto, -essa/-esso, -enta/-ente,
 * -trice/-tore). Symétrique : deux expressions ne se confondent que si l'assemblage le laisse passer (il le vérifie).
 */
const FEMININS: [RegExp, string][] = [
  [/TRICE$/, "TEUR"], [/TORE$/, "TEUR"], [/OINTE$/, "OINT"], [/IENNE$/, "IEN"], [/ENNE$/, "EN"], [/IERE$/, "IER"],
  [/ERE$/, "ER"], [/EUSE$/, "EUR"], [/EFFE$/, "EF"], [/ESSE$/, "E"], [/ELLE$/, "EL"], [/ERIN$/, "ER"], [/FRAU$/, "MANN"],
  [/ENT[AE]$/, "ENT"], [/ANT[AE]$/, "ANT"], [/ORA$/, "OR"], [/AD[AO]$/, "AD"], [/AT[AO]$/, "AT"], [/ETT[AO]$/, "ETT"],
  [/ESS[AO]$/, "ESS"], [/EE$/, "E"],
];
const genre = (mot: string) => {
  if (mot.length < 6 || !/^[A-Z]+$/.test(mot)) return mot;
  const r = FEMININS.find(([re]) => re.test(mot));
  return r ? mot.replace(r[0], r[1]) : mot;
};
/** Écritures sans espace entre les mots : chaque caractère est un mot, comme les idéogrammes. */
const SANS_ESPACE = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Thai}]/gu;
function phraseV2(value: string | null | undefined): string {
  return orthography(value, 2)
    .replace(SANS_ESPACE, " $& ")
    .replace(/[^\p{L}\p{N}\p{M}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
    .split(" ")
    .map(genre)
    .join(" ");
}
/** Marques de genre, de contrat et de temps de travail : ignorées par une règle EXACTE en v2 (« Employé de rayon H/F »).
 * Jamais un mot qui distingue un métier : « Interim Commercial Manager » est le manager de transition. */
const MARQUES = new Set(["NB", "PART", "FULL", "TIME", "PT", "FT", "TEMP", "TEMPORARY", "CDI", "CDD", "MINIJOB", "AUSHILFE",
  "TEILZEIT", "VOLLZEIT", "TEMPS", "PARTIEL", "COMPLET", "PLEIN", "HOURS", "HOUR", "HRS", "HEURES", "HEURE", "UUR", "STUNDEN", "STD", "HORAS",
  "ORE", "TIMER", "WEEK", "WOCHE", "SEMAINE", "SEMANA", "SETTIMANA", "UGE", "VECKA", "PW"]);
// Lettres des marques de genre : H/F/X (fr), M/W/D (de), M/V/X (nl), K/M (pl). Ni B ni N : « F&B » est la restauration.
const LETTRE_DE_GENRE = /^[HFMWDXVK]$/;
function sansMarques(cle: string): string {
  const mots = cle.split(" ");
  return mots
    .filter((m, i) => {
      if (MARQUES.has(m) || /^\d+$/.test(m) || /^\d+(H|U|HRS|STD)$/.test(m)) return false;
      // Une lettre seule n'est une marque que dans une suite de lettres seules (« H F », « M W D »), jamais « Supervisor I ».
      return !(LETTRE_DE_GENRE.test(m) && (LETTRE_DE_GENRE.test(mots[i - 1] ?? "") || LETTRE_DE_GENRE.test(mots[i + 1] ?? "")));
    })
    .join(" ");
}
/** Clés de correspondance d'une expression ou d'un intitulé, pour la garde d'unicité de l'assemblage. */
export const occupationMatchKey = (value: string, version: 1 | 2 = 1) => (version === 2 ? phraseV2(value) : phrase(value));
export const occupationExactKey = (value: string, version: 1 | 2 = 1) => (version === 2 ? sansMarques(phraseV2(value)) : phrase(value));
export type OccupationDecision = {
  jobFunction: string | null;
  occupationGroup: string | null;
  occupationCode: string | null;
  normalizedTitle: string;
  occupationStatus:
    | "CLASSIFIED"
    | "FAMILY_ONLY"
    | "NO_RULE"
    | "AMBIGUOUS"
    | "INPUT_REVIEW";
  occupationSpecializations: string[];
  occupationReleaseId: string;
  seniority: string | null;
  occupationEvidence: {
    inputTitle: string | null;
    department: string | null;
    /** Version de la CORRESPONDANCE (clé de comparaison) ; `normalizedTitle`, stocké en base, reste la forme v1. */
    normalizationVersion: 1 | 2;
    matchedRules: string[];
    candidates: string[];
    familyRule: string | null;
    reason: string;
    seniorityRule: string | null;
    seniorityConfidence: "TITLE_HEURISTIC" | "EXPLICIT_LITERAL" | "UNRESOLVED";
    seniorityReason: string;
    confidence: "EXPLICIT_RULE" | "BROAD_HEURISTIC" | "UNRESOLVED";
  };
};

export function compileOccupationManifest(raw: unknown) {
  const manifest = structuredClone(raw) as OccupationManifest;
  if (
    !manifest ||
    manifest.schemaVersion !== 1 ||
    !manifest.id ||
    !manifest.review?.author ||
    !manifest.review.basis ||
    !Number.isFinite(Date.parse(manifest.review.at))
  )
    throw new Error("Invalid occupation review");
  if (![undefined, 1, 2].includes(manifest.matchingVersion))
    throw new Error("Invalid occupation matching version");
  if (![undefined, 1, 2].includes(manifest.titleReadingVersion))
    throw new Error("Invalid occupation title reading version");
  const version = manifest.matchingVersion ?? 1;
  const cle = (v: string) => occupationMatchKey(v, version);
  const cleValeur = (c: Clause, v: string) => (c.mode === "exact" ? occupationExactKey(v, version) : cle(v));
  const registry = (
    rows: Definition[],
    kind: string,
    keyPattern = /^[a-z0-9][a-z0-9-]*$/,
  ) => {
    if (!Array.isArray(rows)) throw new Error(`Missing ${kind}`);
    const map = new Map<string, Definition>();
    for (const r of rows) {
      if (
        !keyPattern.test(r.key) ||
        r.key === "unclassified" ||
        map.has(r.key) ||
        !r.labels?.fr ||
        Object.values(r.labels).some((x) => typeof x !== "string" || !x.trim())
      )
        throw new Error(`Invalid/duplicate ${kind}: ${r.key}`);
      map.set(r.key, r);
    }
    return map;
  };
  const groups = registry(manifest.groups, "group"),
    families = registry(manifest.families, "family"),
    occupations = registry(manifest.occupations, "occupation");
  const seniorities = registry(
    manifest.seniorities,
    "seniority",
    /^[A-Z][A-Z_]*$/,
  );
  const specializations = registry(
    manifest.specializations ?? [],
    "specialization",
  );
  for (const f of families.values())
    if (!groups.has(f.group ?? "")) throw new Error(`Missing group: ${f.key}`);
  for (const o of occupations.values()) {
    if (!families.has(o.family ?? ""))
      throw new Error(`Missing family: ${o.key}`);
    if (families.has(o.key) || groups.has(o.key))
      throw new Error(`Ambiguous occupation route key: ${o.key}`);
    const connus = new Set([...Object.values(o.labels), ...(o.aliases ?? [])]);
    if (o.titleReadingAliases?.some((a) => !connus.has(a)))
      throw new Error(`Title reading alias outside the occupation vocabulary: ${o.key}`);
    if (o.titleReadingExclusions?.some((x) => typeof x !== "string" || !x.trim()))
      throw new Error(`Invalid title reading exclusion: ${o.key}`);
  }
  const stable = (v: any): string =>
    JSON.stringify(v, (_k, x) =>
      x && typeof x === "object" && !Array.isArray(x)
        ? Object.fromEntries(
            Object.keys(x)
              .sort()
              .map((k) => [k, x[k]]),
          )
        : x,
    );
  for (const key of [
    "patterns",
    "familyRules",
    "departmentRules",
    "familyContexts",
    "seniorityRules",
  ] as const)
    if (stable(manifest[key]) !== stable(legacy[key]))
      throw new Error(
        `Executable compatibility patterns are immutable: ${key}. Use literal phrase rules.`,
      );
  const regex = (p: Pattern) => {
    if (
      typeof p.pattern !== "string" ||
      p.pattern.length > 20_000 ||
      /[^iu]/.test(p.flags ?? "")
    )
      throw new Error("Invalid reviewed family pattern");
    return new RegExp(p.pattern, p.flags ?? "");
  };
  const patterns = Object.fromEntries(
    Object.entries(manifest.patterns).map(([k, v]) => [k, regex(v)]),
  );
  for (const key of [
    "SALON_DEPARTMENT_RE",
    "SALON_TITLE_RE",
    "STORE_DEPARTMENT_RE",
    "STORE_MANAGER_TITLE_RE",
    "RANK_HEAD_RE",
    "RANK_WORDS_RE",
    "SHOP_ONLY_RE",
    "EXECUTIVE_RE",
    "DIRECTOR_RE",
    "MANAGER_RE",
    "IC_MANAGER_RE",
    "SENIOR_RE",
    "JUNIOR_RE",
  ])
    if (!patterns[key]) throw new Error(`Missing migrated pattern ${key}`);
  const compileFamily = (rows: OccupationManifest["familyRules"]) =>
    rows.map((r) => {
      if (!families.has(r.key)) throw new Error(`Missing family for ${r.id}`);
      return { ...r, re: regex(r) };
    });
  const familyRules = compileFamily(manifest.familyRules),
    departmentRules = compileFamily(manifest.departmentRules);
  const compileDecisions = (
    rows: PatternDecision[],
    keys: Map<string, Definition>,
  ) =>
    rows.map((r) => {
      if (!keys.has(r.key) || !r.id || !r.all.length)
        throw new Error(`Invalid contextual decision ${r.id}`);
      const compileClause = (c: PatternClause) => {
        if (!["title", "department"].includes(c.field))
          throw new Error("Invalid contextual field");
        return { ...c, re: regex(c) };
      };
      return {
        ...r,
        all: r.all.map(compileClause),
        exclude: (r.exclude ?? []).map(compileClause),
      };
    });
  const familyContexts = compileDecisions(manifest.familyContexts, families),
    seniorityRules = compileDecisions(manifest.seniorityRules, seniorities);
  const ruleIds = new Set<string>();
  for (const r of manifest.rules) {
    if (
      !r.id ||
      ruleIds.has(r.id) ||
      !occupations.has(r.occupation) ||
      !r.evidence ||
      !r.all?.length
    )
      throw new Error(`Invalid occupation rule ${r.id}`);
    ruleIds.add(r.id);
    for (const key of r.specializations ?? [])
      if (!specializations.has(key))
        throw new Error(`Missing specialization ${key}`);
    for (const c of [...r.all, ...(r.exclude ?? [])])
      if (
        !["title", "department"].includes(c.field) ||
        !c.any?.length ||
        c.any.some((v) => typeof v !== "string" || !phrase(v) || !cleValeur(c, v)) ||
        !["phrase", "exact"].includes(c.mode ?? "phrase")
      )
        throw new Error(`Invalid clause ${r.id}`);
  }
  for (const r of manifest.rules)
    for (const id of r.supersedes ?? [])
      if (id === r.id || !ruleIds.has(id))
        throw new Error(`Invalid precedence ${r.id}/${id}`);
  // Precedence is a DAG: no contradictory rules can hide one another.
  const byId = new Map(manifest.rules.map((r) => [r.id, r]));
  function descendants(id: string, path = new Set<string>()): Set<string> {
    if (path.has(id)) throw new Error(`Cyclic occupation precedence ${id}`);
    const next = new Set(path).add(id),
      out = new Set<string>();
    for (const child of byId.get(id)?.supersedes ?? []) {
      out.add(child);
      for (const d of descendants(child, next)) out.add(d);
    }
    return out;
  }
  const supersedes = new Map(
    manifest.rules.map((r) => [r.id, descendants(r.id)]),
  );
  const compiledRules = manifest.rules.map((r) => ({
    ...r,
    all: r.all.map((c) => ({ ...c, any: c.any.map((v) => cleValeur(c, v)) })),
    exclude: (r.exclude ?? []).map((c) => ({ ...c, any: c.any.map((v) => cleValeur(c, v)) })),
  }));
  const anchorRules = new Map<string, Set<number>>();
  for (const [i, r] of compiledRules.entries()) {
    const titleClause = r.all.find((c) => c.field === "title");
    if (!titleClause)
      throw new Error(`An occupation rule needs a title witness: ${r.id}`);
    for (const value of titleClause.any) {
      const first = value.split(" ")[0];
      const set = anchorRules.get(first) ?? new Set<number>();
      set.add(i);
      anchorRules.set(first, set);
    }
  }
  type Entree = { title: string; department: string; exact: { title: string; department: string } };
  // v1 : la clé se calcule sur l'intitulé déjà normalisé, comme avant ; v2 : sur l'intitulé observé (l'orthographe v2
  // garde le dakuten et les voyelles thaïes que la normalisation v1 a effacés).
  const entree = (title: string | null | undefined, department: string | null | undefined): Entree => {
    const cles = version === 2 ? { title: cle(title ?? ""), department: cle(department ?? "") }
      : { title: phrase(normalizeOccupationTitle(title)), department: phrase(normalizeOccupationTitle(department)) };
    return { ...cles, exact: version === 2 ? { title: sansMarques(cles.title), department: sansMarques(cles.department) } : cles };
  };
  const clauses = (c: Clause, input: Entree) =>
    c.any.some((v) =>
      c.mode === "exact"
        ? input.exact[c.field] === v
        : ` ${input[c.field]} `.includes(` ${v} `),
    );
  const compilePhraseDecisions = (
    rows: NonNullable<OccupationManifest["familyPhraseRules"]>,
    keys: Map<string, Definition>,
    allowAbstention = false,
  ) => {
    const ids = new Set<string>();
    return rows.map((r) => {
      if (
        !r.id ||
        ids.has(r.id) ||
        (r.key === null ? !allowAbstention || !r.reason : !keys.has(r.key)) ||
        !r.all?.length
      )
        throw new Error(`Invalid literal decision ${r.id}`);
      ids.add(r.id);
      const compile = (c: Clause) => {
        if (
          !["title", "department"].includes(c.field) ||
          !c.any?.length ||
          c.any.some((v) => typeof v !== "string" || !phrase(v) || !cleValeur(c, v)) ||
          !["phrase", "exact"].includes(c.mode ?? "phrase")
        )
          throw new Error(`Invalid literal clause ${r.id}`);
        return { ...c, any: c.any.map((v) => cleValeur(c, v)) };
      };
      return {
        ...r,
        all: r.all.map(compile),
        exclude: (r.exclude ?? []).map(compile),
      };
    });
  };
  const familyPhrases = compilePhraseDecisions(
      manifest.familyPhraseRules ?? [],
      families,
    ),
    seniorityPhrases = compilePhraseDecisions(
      manifest.seniorityPhraseRules ?? [],
      seniorities,
      true,
    );
  const freeze = (x: any) => {
    if (x && typeof x === "object" && !Object.isFrozen(x)) {
      Object.values(x).forEach(freeze);
      Object.freeze(x);
    }
  };
  freeze(manifest);
  return {
    manifest,
    groups,
    families,
    occupations,
    seniorities,
    specializations,
    /** Les métiers dont une règle EXCLUT cet intitulé (ses mots d'encadrement jugés, D-475 §32 a) : un métier lu dans
     * « Responsable vendeur » n'est pas « Vendeur » (point 38). */
    excludedOccupations(title: string | null | undefined, department?: string | null): Set<string> {
      const input = entree(title, department);
      return new Set(compiledRules.filter((r) => r.exclude.some((c) => clauses(c, input))).map((r) => r.occupation));
    },
    classify(
      title: string | null | undefined,
      department?: string | null,
    ): OccupationDecision {
      const t = normalizeOccupationTitle(title),
        d = normalizeOccupationTitle(department);
      const result: OccupationDecision = {
        jobFunction: null,
        occupationGroup: null,
        occupationCode: null,
        normalizedTitle: t,
        occupationStatus: "NO_RULE",
        occupationSpecializations: [],
        occupationReleaseId: manifest.id,
        seniority: null,
        occupationEvidence: {
          inputTitle: title ?? null,
          department: department ?? null,
          normalizationVersion: version,
          matchedRules: [],
          candidates: [],
          familyRule: null,
          reason:
            "No reviewed title/context rule matched; investigate this observed variant.",
          seniorityRule: null,
          seniorityConfidence: "UNRESOLVED",
          seniorityReason: "No explicit rank evidence in the observed inputs.",
          confidence: "UNRESOLVED",
        },
      };
      // Never discard/truncate the offer to satisfy a classifier's input bounds.
      if (!t || t.length > 1024 || d.length > 1024) {
        result.occupationStatus = "INPUT_REVIEW";
        result.occupationEvidence.reason = !t
          ? "No usable title in the classification input."
          : "Input exceeds reviewed classifier bounds; original title retained.";
        return result;
      }
      let family: { key: string; id: string } | undefined;
      const inputs = { title: t, department: d };
      const matchesPattern = (r: (typeof familyContexts)[number]) =>
        r.all.every((c) => c.re.test(inputs[c.field])) &&
        !r.exclude.some((c) => c.re.test(inputs[c.field]));
      family = familyContexts.find(matchesPattern);
      const tail = t
        .replace(patterns.RANK_HEAD_RE, "")
        .replace(patterns.RANK_WORDS_RE, " ")
        .replace(/\s+/g, " ")
        .trim();
      if (!family && tail !== t && tail && !patterns.SHOP_ONLY_RE.test(tail))
        family = familyRules.find((r) => r.re.test(tail));
      family ??= familyRules.find((r) => r.re.test(t));
      family ??= departmentRules.find((r) => r.re.test(d));
      if (family) {
        result.jobFunction = family.key;
        result.occupationEvidence.familyRule = family.id;
        result.occupationStatus = "FAMILY_ONLY";
        result.occupationEvidence.confidence = "BROAD_HEURISTIC";
        result.occupationEvidence.reason =
          "Only a broad family heuristic matched; precise occupation requires review.";
      }
      const input = entree(title, department);
      const phraseMatches = (rows: typeof familyPhrases) =>
        rows.filter(
          (r) =>
            r.all.every((c) => clauses(c, input)) &&
            !r.exclude.some((c) => clauses(c, input)),
        );
      const familyMatches = phraseMatches(familyPhrases),
        familyKeys = [...new Set(familyMatches.map((r) => r.key))];
      if (familyKeys.length) {
        result.jobFunction = familyKeys.length === 1 ? familyKeys[0] : null;
        result.occupationStatus =
          familyKeys.length === 1 ? "FAMILY_ONLY" : "AMBIGUOUS";
        result.occupationEvidence.familyRule = familyMatches
          .map((r) => r.id)
          .sort()
          .join(",");
        result.occupationEvidence.confidence =
          familyKeys.length === 1 ? "EXPLICIT_RULE" : "UNRESOLVED";
        result.occupationEvidence.reason =
          familyKeys.length === 1
            ? "Reviewed literal family/context rule."
            : "Conflicting literal family rules; no forced family.";
      }
      const applicable = new Set(
        input.title
          .split(" ")
          .flatMap((word) => [...(anchorRules.get(word) ?? [])]),
      );
      const matches = [...applicable]
        .map((i) => compiledRules[i])
        .filter(
          (r) =>
            r.all.every((c) => clauses(c, input)) &&
            !r.exclude.some((c) => clauses(c, input)),
        );
      const dominated = new Set(
        matches.flatMap((r) => [...supersedes.get(r.id)!]),
      );
      const winners = matches.filter((r) => !dominated.has(r.id));
      const codes = [...new Set(winners.map((r) => r.occupation))].sort();
      result.occupationEvidence.matchedRules = matches.map((r) => r.id).sort();
      result.occupationEvidence.candidates = codes;
      if (codes.length === 1) {
        result.occupationCode = codes[0];
        result.jobFunction = occupations.get(codes[0])!.family!;
        result.occupationStatus = "CLASSIFIED";
        result.occupationSpecializations = [
          ...new Set(winners.flatMap((r) => r.specializations ?? [])),
        ].sort();
        result.occupationEvidence.reason =
          "Reviewed occupation rule with explicit title/context evidence.";
        result.occupationEvidence.confidence = "EXPLICIT_RULE";
      } else if (codes.length > 1) {
        result.occupationStatus = "AMBIGUOUS";
        result.occupationEvidence.reason =
          "Multiple distinct occupations match. Preserve candidates; no array-order tie-break.";
        result.occupationEvidence.confidence = "UNRESOLVED";
        const fs = new Set(codes.map((c) => occupations.get(c)!.family!));
        result.jobFunction = fs.size === 1 ? [...fs][0] : null;
      }
      result.occupationGroup = result.jobFunction
        ? families.get(result.jobFunction)!.group!
        : null;
      const rank = seniorityRules.find(matchesPattern);
      if (rank) {
        result.seniority = rank.key;
        result.occupationEvidence.seniorityRule = rank.id;
        result.occupationEvidence.seniorityConfidence = "TITLE_HEURISTIC";
        result.occupationEvidence.seniorityReason =
          "Migrated title heuristic; not a source-certified experience level.";
      }
      const rankMatches = phraseMatches(seniorityPhrases),
        rankKeys = [...new Set(rankMatches.map((r) => r.key))];
      if (rankKeys.length) {
        result.seniority = rankKeys.length === 1 ? rankKeys[0] : null;
        result.occupationEvidence.seniorityConfidence = result.seniority
          ? "EXPLICIT_LITERAL"
          : "UNRESOLVED";
        result.occupationEvidence.seniorityReason = rankMatches
          .map((r) => r.reason ?? "Reviewed literal rank evidence.")
          .join(" ");
        result.occupationEvidence.seniorityRule = rankMatches
          .map((r) => r.id)
          .sort()
          .join(",");
      }
      // Absence of a rank is absence of evidence, never MID.
      return result;
    },
  };
}
export type CompiledOccupationTaxonomy = ReturnType<
  typeof compileOccupationManifest
>;
export function occupationLabel(
  def: Definition | undefined,
  locale = "fr",
): string | null {
  return def
    ? (def.labels[locale] ?? def.labels.fr ?? Object.values(def.labels)[0])
    : null;
}

/** Fields the engine derives from the manifest (family group, rule
 * specializations). They stopped being columns in lot F1 (2026-09-16): readers
 * recompute them from the active release instead of trusting a stored copy. */
export type OccupationDerivedField = "occupationGroup" | "occupationSpecializations";
export type PersistedOccupationDecision = Omit<OccupationDecision, OccupationDerivedField>;
/** The exact shape written on a Job: the decision without its derived fields. */
export function persistedOccupationDecision(decision: OccupationDecision): PersistedOccupationDecision {
  const { occupationGroup: _group, occupationSpecializations: _specializations, ...persisted } = decision;
  return persisted;
}
