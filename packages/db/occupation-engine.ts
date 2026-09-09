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
  return (value ?? "")
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
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
  isRetail: boolean | null;
  occupationEvidence: {
    inputTitle: string | null;
    department: string | null;
    normalizationVersion: 1;
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
        c.any.some((v) => typeof v !== "string" || !phrase(v)) ||
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
    all: r.all.map((c) => ({ ...c, any: c.any.map(phrase) })),
    exclude: (r.exclude ?? []).map((c) => ({ ...c, any: c.any.map(phrase) })),
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
  const clauses = (c: Clause, input: { title: string; department: string }) =>
    c.any.some((v) =>
      c.mode === "exact"
        ? input[c.field] === v
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
          c.any.some((v) => typeof v !== "string" || !phrase(v)) ||
          !["phrase", "exact"].includes(c.mode ?? "phrase")
        )
          throw new Error(`Invalid literal clause ${r.id}`);
        return { ...c, any: c.any.map(phrase) };
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
  const aliases = new Map<string, Set<string>>();
  for (const o of occupations.values())
    for (const a of [...Object.values(o.labels), ...(o.aliases ?? [])]) {
      const k = phrase(a),
        set = aliases.get(k) ?? new Set<string>();
      set.add(o.key);
      aliases.set(k, set);
    }

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
    queryOccupations(value: string) {
      const ids = aliases.get(phrase(value));
      return ids?.size === 1 ? [...ids] : [];
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
        isRetail: null,
        occupationEvidence: {
          inputTitle: title ?? null,
          department: department ?? null,
          normalizationVersion: 1,
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
      const input = { title: phrase(t), department: phrase(d) };
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
      result.isRetail =
        result.occupationGroup === null
          ? null
          : result.occupationGroup === "retail";
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
