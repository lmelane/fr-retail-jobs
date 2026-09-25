import { log } from '../observability/logger.js';
import type { PrismaClient } from '@prisma/client';
import type { IngestStats } from './ingest.js';
import { isTrustedForAttestation, isDeclaredEmptyEnumeration } from './attestation.js';
import { recordSourceRunSummary } from '../connectors/sourceStore.js';
import { NEGATIVE_PROOF_RETENTION, retentionClass, type RetentionClass } from './publicationDisposition.js';
import { FULL_RUN_MARKER } from './fullRunMarker.js';

/**
 * Source health, run after every ingest.
 *
 * An aggregator does not break loudly. Vendors rotate a public search key, move
 * a listing path, or start refusing a non-browser client, and the adapter for
 * that source quietly returns zero. The cron still exits 0, the dashboard still
 * says "success", and the only visible symptom is a Maison that stopped having
 * openings — which looks exactly like a Maison that stopped hiring.
 *
 * This has already happened twice here: a rotated Welcome to the Jungle key put
 * false "no ATS" verdicts in three discovery batches, and Estée Lauder's board
 * began answering every request with a human-verification page.
 *
 * So each run compares what a source returned against what it returned before,
 * and a source that WAS producing and now produces nothing is an incident — not
 * a quiet zero.
 */

/** A drop below this share of the previous run is treated as a failure. */
const COLLAPSE_RATIO = 0.5;

/** Runs to keep per source; enough to see a trend without growing forever. */
const HISTORY = 10;

export type SourceHealth = {
  source: string;
  status: 'OK' | 'DEGRADED' | 'BROKEN' | 'NEW';
  jobs: number;
  previous: number | null;
  note?: string;
  /** "desc 62% date 0% pays 88% url 100%" — recorded on every run for trend. */
  coverage?: string;
  /** Same rates as numbers 0..1, written to SourceRun/Source COLUMNS (L-02). */
  rates?: { description: number; date: number; country: number; url: number };
  /**
   * L'incident ne tient QU'à des retenues qui ne bloquent pas le RUN — preuve de la source (D-453 §1, D-456 §1)
   * ou décision de l'équipe (D-456 §2) —, sans autre défaut de collecte ni saut détecté par la garde. Visible,
   * non bloquant.
   */
  nonBlockingRetentionOnly?: true;
  /**
   * Le code de l'incident quand la santé le nomme ; absent, l'attribution reste `SOURCE_HEALTH_REGRESSION`.
   * Une énumération NON PROUVÉE n'est pas RÉFUTÉE (D-453 §1) : deux codes, tous deux bloquants.
   */
  finding?: HealthFinding;
  /** Offres retenues à ce run, tous motifs confondus. */
  retained?: number;
  /**
   * Les retenues de ce run par motif, ce que la source a collecté et, par motif, combien restent EN LIGNE depuis une
   * collecte antérieure (`online`, absent si non mesuré) : l'alerte en tire un texte par motif. Une retenue empêche
   * CE RUN de publier ; elle ne retire une offre déjà publiée que si son motif porte une disposition.
   */
  retention?: { collected: number; byReason: Record<string, number>; online?: Record<string, number> };
  /**
   * La source a échoué avant toute collecte aboutie (exception de la source, délai, anti-bot) : ce RUN n'en a rien
   * collecté jusqu'au bout et n'en retire rien, ses offres déjà en ligne restent publiées (L-01, `refresh.ts`).
   */
  notCollected?: true;
  /**
   * La garde de la preuve négative n'a trouvé aucun RUN complet antérieur pour cette source : la retenue reste
   * non bloquante (D-453 §1), la garde le dit.
   */
  guardWithoutReference?: true;
  /**
   * Posé par l'orchestrateur une fois les causes classées : l'incident fait-il échouer le RUN ? Absent = oui,
   * le sens prudent pour tout chemin qui ne classe pas (commande `ingest --source`).
   */
  blocking?: boolean;
};

export type HealthFinding = 'ENUMERATION_NOT_PROVEN' | 'ENUMERATION_REFUTED' | 'NATIVE_RETENTION_JUMP';

/**
 * LA GARDE DE LA PREUVE NÉGATIVE — garde TECHNIQUE, pas une décision (demandée le 25/09/2026).
 *
 * « L'annonce Workday ne nomme pas d'employeur » (`WORKDAY_EMPLOYER_ABSENT_IN_DETAIL`) est la seule preuve
 * NÉGATIVE : un portail multi-marques et une page dont le format a changé la produisent à l'identique. Un
 * changement de format se voit d'un RUN à l'autre : la part de la source que ce motif laisse non publiée bondit.
 * Cette retenue reste donc non bloquante sauf si cette part dépasse la part non publiée de la RÉFÉRENCE de plus
 * de `RETENTION_JUMP_POINTS` ET d'au moins `RETENTION_JUMP_MIN_POSTINGS` offres. Les preuves positives de la
 * source (candidature close, 404, retrait…) et les décisions de l'équipe ne sont jamais soumises à la garde.
 *
 * LA RÉFÉRENCE est le dernier RUN COMPLET de production où la source a été collectée : un run qui a parcouru
 * toutes les sources actives et fini sa boucle, reconnaissable à son événement `FULL_RUN_MARKER` ; jamais un run
 * ciblé (`INGEST_ONLY_KEYS`), un canari ou `ingest --source`, qui ne l'émettent pas. Sa part non publiée
 * (`fetched − accepted`, SourceRun) compte tous les motifs : c'est une borne HAUTE de sa part Workday, ce qui rend
 * la garde moins sensible, jamais plus. Sans référence, la retenue reste non bloquante (D-453 §1 interdit qu'une
 * retenue native bloque faute d'historique) et la ligne « garde technique sans référence » est visible au bilan.
 *
 * Rejeu du RUN du 24/09 (`audits/2026-09-24/scripts/rejeu-classement-2409.mts`) : voir le runbook.
 *
 * LIMITES CONNUES : une source déjà saturée ne peut plus bondir (Levi's : 1 268 offres non publiées sur 1 270,
 * 99,8 %) ; la garde ne compare qu'au RUN complet précédent, donc un saut accepté devient la référence suivante ;
 * pour un jobboard filtré par secteur, la part non publiée de la référence compte aussi les offres hors secteur ;
 * SourceRun ne garde que `HISTORY` jours, au-delà la garde est sans référence.
 */
export const RETENTION_JUMP_POINTS = 0.1;
export const RETENTION_JUMP_MIN_POSTINGS = 10;
export { FULL_RUN_MARKER };
/** La référence : ce qu'un RUN complet a collecté (`fetched`) et publié (`accepted`, SourceRun) pour la source. */
export type RetentionBaseline = { fetched: number; accepted: number };

/**
 * Field-coverage floors (audit L-02 generalized). A source can keep its volume
 * while silently losing a field — 3 780 Eightfold offers lost their description
 * behind a renamed API key and nothing alerted. Gated: description and apply
 * URL, the two direct product promises. Date and country are RECORDED for
 * trend but not gated — several honest feeds never ship them (LVMH has no date
 * field at all), and a permanent alert is noise that trains people to ignore
 * the digest; their fix is per-adapter work (F-05), tracked by the rates.
 */
const DESCRIPTION_FLOOR = 0.7;
const URL_FLOOR = 0.99;
/** Below this many offers, rates flap on nothing — skip the gate. */
const COVERAGE_MIN_JOBS = 20;

export type HealthReport = {
  checkedAt: Date;
  ok: number;
  degraded: number;
  broken: number;
  incidents: SourceHealth[];
};

/**
 * Compares this run's per-source counts with the PREVIOUS run's.
 *
 * The baseline is the last SourceRun recorded for each source — not the live
 * JobSource state. Reading live state compared a run to itself: checkSourceHealth
 * runs right after the ingest has already written this run's rows, so "before"
 * included "now" and a source that returned zero still looked healthy until the
 * refresh pass emptied it 48h later — exactly when the alert was needed.
 */
export async function checkSourceHealth(
  prisma: PrismaClient,
  stats: IngestStats[],
): Promise<HealthReport> {
  const previous = await previousCounts(prisma, stats.map(s => s.source));
  const results = stats.map(stat => {
    const before = previous.get(stat.source);
    return evaluateSourceHealth(stat, before?.jobs ?? null, before?.retention ?? null);
  });

  await recordRun(prisma, results, stats);

  const incidents = results.filter((r) => r.status === 'BROKEN' || r.status === 'DEGRADED');
  return {
    checkedAt: new Date(),
    ok: results.filter((r) => r.status === 'OK').length,
    degraded: results.filter((r) => r.status === 'DEGRADED').length,
    broken: results.filter((r) => r.status === 'BROKEN').length,
    incidents,
  };
}

/**
 * The health of ONE source run, from its counters, the volume of its last productive run and — for the negative
 * proof only — what the last complete RUN left unpublished.
 * Pure: `checkSourceHealth` persists it, the replay of a past RUN re-reads it.
 */
export function evaluateSourceHealth(stat: IngestStats, before: number | null, retentionBaseline: RetentionBaseline | null = null): SourceHealth {
  const jobs = stat.created + stat.merged + stat.updated;
  const retention = stat.held ? describeRetention(stat) : undefined;
  const base = { source: stat.source, jobs, previous: before, coverage: coverageOf(stat), rates: ratesOf(stat),
    ...(stat.held ? { retained: stat.held, retention: { collected: stat.fetched, byReason: countedReasons(stat),
      ...(stat.heldOnline ? { online: { ...stat.heldOnline } } : {}) } } : {}) };
  if (stat.errors > 0) {
    const errors = `${plural(stat.errors, 'erreur', 'erreurs')} de collecte ou d’écriture${failureCauses(stat)}${stat.errorNote ? ` : ${stat.errorNote}` : ''}${stat.rejected ? ` · ${plural(stat.rejected, 'ligne rejetée', 'lignes rejetées')} avec motif (${Object.entries(stat.rejectedReasons ?? {}).map(([k, v]) => `${k}=${v}`).join(', ')})` : ''}`;
    // Nothing sealed and nothing read: the source failed before any collection completed (`runIngest` catch path).
    const notCollected = stat.fetched === 0 && !stat.captureBatchId;
    // The error blocks; a retention next to it stays named, never hidden behind it.
    return { ...base, status: jobs > 0 ? 'DEGRADED' : 'BROKEN', note: retention ? `${errors} · ${retention.note}` : errors,
      ...(notCollected ? { notCollected: true } : {}) };
  }
  const collection = collectionHealth(stat, base, jobs, before);
  if (!retention) return collection;
  /**
   * D-453 §1 et D-456 : une retenue sur preuve de la source, ou écartée par l'équipe, reste visible mais ne fait
   * plus échouer le RUN.
   *
   * Le reste de la collecte est jugé comme pour toute source : une troncature, une énumération non prouvée ou
   * réfutée, un effondrement ou une couverture de champ effondrée d'une source qui retient AUSSI une offre restent
   * bloquants et nommés dans la même note. Seule une retenue sans aucun autre défaut, sans motif à instruire, et
   * que la garde de la preuve négative ne signale pas, est marquée non bloquante.
   */
  const otherDefect = collection.status === 'BROKEN' || collection.status === 'DEGRADED';
  const guard = retention.nonBlocking && !otherDefect ? negativeProofGuard(stat, retentionBaseline) : undefined;
  const jumped = guard?.kind === 'JUMP';
  const note = otherDefect ? `${collection.note} · ${retention.note}`
    : [`${retention.note} ; ${enumerationLabel(stat)}`, guard?.note].filter(Boolean).join(' · ');
  const finding = otherDefect ? collection.finding : jumped ? 'NATIVE_RETENTION_JUMP' as const : undefined;
  const nonBlockingOnly = retention.nonBlocking && !otherDefect && !jumped;
  return { ...base, status: jobs > 0 ? 'DEGRADED' : 'BROKEN', note, ...(finding ? { finding } : {}),
    ...(nonBlockingOnly ? { nonBlockingRetentionOnly: true } : {}),
    // A team exclusion alone is no issue on ANY path (`issuesFromResult`): `ingest --source` exits 0 on it, so its
    // alert says non-blocking too. A native retention stays strict there: an issue, exit 1, listed as blocking.
    ...(nonBlockingOnly && retention.teamOnly ? { blocking: false } : {}),
    ...(guard?.kind === 'NO_REFERENCE' ? { guardWithoutReference: true } : {}) };
}

/** Plain words for a bounded identity-refusal code (`MOTIFS_IDENTITE`, `identity/errors.ts`). */
const IDENTITY_REFUSAL = 'EmployerIdentityReviewRequired';
const IDENTITY_MOTIF: Readonly<Record<string, string>> = {
  PORTAL_OWNER_NOT_CERTIFIED: 'employeur non certifié',
  PORTAL_OWNER_REPLACES_EMPLOYER: 'le portail contredit l’employeur déjà attribué',
  ALIAS_CONFLICT: 'deux alias mènent à deux employeurs',
  ALIAS_SOURCE_OR_TENANT_CHANGED: 'alias qui ne vaut plus pour cette source',
  EMPLOYER_SPELLING_DIVERGED: 'nouvelle graphie de l’employeur',
  EMPLOYER_TARGET_MISMATCH: 'employeur différent de celui déjà attribué',
  SOURCE_NEVER_PUBLISHED_FOR_HOUSE: 'source jamais publiée pour cette Maison',
};

/**
 * The known cause of posting write failures, in plain words: « dont 59 refus d’identité (employeur non certifié : 59) ».
 * Read from the bounded codes the sealed report keeps (`writeFailures`); an identity refusal counted by an older run
 * without them still says what it is.
 */
function failureCauses(stat: IngestStats): string {
  const counted = Object.entries(stat.writeFailures ?? {}).filter(([code]) => code === IDENTITY_REFUSAL || code.startsWith(`${IDENTITY_REFUSAL}:`));
  const refusals = counted.length ? counted.reduce((total, [, n]) => total + n, 0)
    : stat.issues?.find(issue => issue.code === IDENTITY_REFUSAL)?.count ?? 0;
  if (!refusals) return '';
  const motifs = counted.map(([code, n]) => [code.slice(IDENTITY_REFUSAL.length + 1), n] as const)
    .sort(([a, n], [b, m]) => m - n || a.localeCompare(b))
    .map(([motif, n]) => `${IDENTITY_MOTIF[motif] ?? (motif || 'motif non précisé')} : ${n}`);
  return `, dont ${refusals} refus d’identité (${motifs.length ? motifs.join(' ; ') : 'motif non compté'})`;
}

function countedReasons(stat: IngestStats): Record<string, number> {
  return Object.fromEntries(Object.entries(stat.heldReasons ?? {}).filter(([, n]) => n > 0).sort(([a], [b]) => a.localeCompare(b)));
}

function plural(n: number, one: string, many: string): string {
  return `${n} ${n > 1 ? many : one}`;
}

/**
 * Les retenues, séparées par ce qui les fonde : preuve de la source (D-453 §1, D-456 §1), décision de l'équipe
 * (D-456 §2), ou rien de démontré — « à instruire ». Une retenue décidée n'est jamais dite « non résolue ».
 */
function describeRetention(stat: IngestStats): { note: string; nonBlocking: boolean; teamOnly: boolean } {
  const reasons = Object.entries(countedReasons(stat));
  const sum = (list: [string, number][]) => list.reduce((total, [, n]) => total + n, 0);
  const named = (list: [string, number][]) => list.map(([reason, n]) => `${reason}=${n}`).join(', ');
  const of = (kind: RetentionClass) => reasons.filter(([reason]) => retentionClass(reason) === kind);
  const native = of('NATIVE'), team = of('TEAM_DECISION'), toInstruct = of('TO_INSTRUCT');
  const uncounted = (stat.held ?? 0) - sum(reasons);
  const parts = [
    native.length ? `${sum(native)} sur preuve de la source (${named(native)})` : '',
    team.length ? `${plural(sum(team), 'écartée', 'écartées')} par l’équipe (${named(team)})` : '',
    toInstruct.length ? `${sum(toInstruct)} à instruire (${named(toInstruct)})` : '',
    // A retention whose reason was not counted proves nothing: it is to be instructed like any other.
    uncounted !== 0 ? `${uncounted} sans motif compté, à instruire` : '',
  ].filter(Boolean);
  const nonBlocking = native.length + team.length > 0 && !toInstruct.length && uncounted === 0;
  return { note: `${plural(stat.held ?? 0, 'annonce retenue', 'annonces retenues')} : ${parts.join(' · ')}`,
    nonBlocking, teamOnly: nonBlocking && !native.length };
}

function enumerationLabel(stat: IngestStats): string {
  if (stat.complete === true) return 'énumération prouvée';
  if (stat.complete !== false) return 'énumération inconnue : aucune attestation d’absence';
  return stat.enumerationReading === 'NOT_PROVEN' ? 'énumération non prouvée : aucune attestation d’absence'
    : 'énumération réfutée : aucune attestation d’absence';
}

/**
 * The negative-proof guard. Silent unless the Workday reason is present. Without a complete RUN of reference it
 * says so and blocks nothing (D-453 §1); with one, it blocks only a jump of the share that reason leaves
 * unpublished. The comparison is made in whole basis points, so exactly +10 points is never a jump.
 */
function negativeProofGuard(stat: IngestStats, baseline: RetentionBaseline | null): { kind: 'NO_REFERENCE' | 'JUMP'; note: string } | undefined {
  const negative = stat.heldReasons?.[NEGATIVE_PROOF_RETENTION] ?? 0;
  if (negative <= 0 || stat.fetched <= 0) return undefined;
  const pct = (n: number) => `${(n * 100).toFixed(1).replace('.', ',')} %`;
  const now = negative / stat.fetched;
  if (!baseline || baseline.fetched <= 0) {
    return { kind: 'NO_REFERENCE',
      note: `garde technique sans référence : aucun RUN complet antérieur n’a collecté la source (employeur absent : ${pct(now)} des offres collectées)` };
  }
  const before = (baseline.fetched - baseline.accepted) / baseline.fetched;
  const excess = negative - Math.round(before * stat.fetched);
  const jumpBasisPoints = Math.round(now * 10_000) - Math.round(before * 10_000);
  if (jumpBasisPoints <= Math.round(RETENTION_JUMP_POINTS * 10_000) || excess < RETENTION_JUMP_MIN_POSTINGS) return undefined;
  return { kind: 'JUMP',
    note: `garde technique : employeur absent sur ${pct(now)} des offres contre ${pct(before)} non publiées au RUN complet de référence (+${excess} offres), preuve négative à instruire` };
}

/** Everything a run is judged on besides write errors and retentions: extent, volume, field coverage. */
function collectionHealth(stat: IngestStats, base: Omit<SourceHealth, 'status'>, jobs: number, before: number | null): SourceHealth {
  if (stat.truncated) {
    return { ...base, status: 'DEGRADED',
      note: `troncature : ${stat.fetched} collectées` +
        (stat.declaredTotal == null ? ', total inconnu' : ` sur ${stat.declaredTotal} déclarées`) };
  }
  if (jobs === 0 && !stat.rejected && isDeclaredEmptyEnumeration(stat)) {
    return { ...base, status: 'OK', note: 'éditeur : zéro annoncé, parcours complet sans erreur' };
  }
  if (before === null && jobs === 0) {
    return { ...base, status: 'BROKEN', note: 'premier run sans offre exploitable' };
  }
  /**
   * Une énumération RÉFUTÉE est un défaut : le balayage n'a pas atteint la fin, on le dit.
   *
   * Une énumération NON PROUVÉE (`complete: false` sans aucun fait observé qui la contredise, `enumerationReading.ts`)
   * en est un aussi, et BLOQUANT au même titre (D-453 §1 : « les énumérations non prouvées […] restent des échecs
   * à instruire ») — mais elle ne se dit pas « réfutée » : l'étiquette et le code d'attribution changent, rien
   * d'autre. Un `complete: false` que le RUN n'a pas lu (`enumerationReading` absent) garde le sens documenté
   * du contrat : réfutée.
   *
   * Une énumération INCONNUE n'en est pas un. Mesuré le 2026-09-11 : **149 sources sur 440** ne déclarent aucun
   * total (teamtailor 113, recruitee 22, personio 14) — les marquer DEGRADED faisait passer 216 sources pour
   * dégradées alors qu'elles lisaient parfaitement leur board, et noyait les vraies pannes dans le bruit du
   * digest. Le droit d'attester reste arbitré séparément par `isTrustedForAttestation`.
   */
  if (jobs > 0 && stat.complete === false) {
    if (stat.enumerationReading === 'NOT_PROVEN') {
      return { ...base, status: 'DEGRADED', finding: 'ENUMERATION_NOT_PROVEN',
        note: 'énumération non prouvée : l’adaptateur ne démontre pas la fin du listing, aucune coupure observée, à instruire' };
    }
    const by = stat.enumerationRefutedBy?.length ? ` (${stat.enumerationRefutedBy.join(', ')})` : '';
    return { ...base, status: 'DEGRADED', finding: 'ENUMERATION_REFUTED',
      note: `énumération réfutée : le balayage n’a pas atteint la fin du listing${by}` };
  }

  // Zero from a source that was producing is the signal that matters most:
  // it is what a rotated key, a moved path and a new bot shield all look like.
  if (jobs === 0) {
    return {
      source: stat.source,
      status: 'BROKEN',
      jobs,
      previous: before,
      note:
        before != null && before > 0
          ? `ne rend aucune offre, ${before} au dernier run productif`
          : 'ne rend toujours aucune offre : n’a jamais produit depuis son catalogage',
    };
  }

  if (before != null && before > 0 && jobs < before * COLLAPSE_RATIO) {
    return {
      source: stat.source,
      status: 'DEGRADED',
      jobs,
      previous: before,
      note: `${Math.round((1 - jobs / before) * 100)} % d’offres en moins qu’au run précédent`,
      coverage: coverageOf(stat),
      rates: ratesOf(stat),
    };
  }

  // Volume held — but did the FIELDS? (The Eightfold failure mode.)
  const fieldIncident = fieldCoverageIncident(stat);
  if (fieldIncident) {
    return {
      source: stat.source,
      status: 'DEGRADED',
      jobs,
      previous: before,
      note: fieldIncident,
      coverage: coverageOf(stat),
      rates: ratesOf(stat),
    };
  }

  return {
    source: stat.source,
    status: before === null ? 'NEW' : 'OK',
    jobs,
    previous: before,
    coverage: coverageOf(stat),
    rates: ratesOf(stat),
  };
}

function coverageOf(stat: IngestStats): string | undefined {
  if (!stat.inSector) return undefined;
  const pct = (n: number) => `${Math.round((n / stat.inSector) * 100)}%`;
  return `desc ${pct(stat.withDescription)} date ${pct(stat.withDate)} pays ${pct(stat.withCountry)} url ${pct(stat.withUrl)}`;
}

/** The same coverage as numbers, for the queryable columns (L-02). */
function ratesOf(stat: IngestStats): SourceHealth['rates'] {
  if (!stat.inSector) return undefined;
  const rate = (n: number) => Math.round((n / stat.inSector) * 1000) / 1000;
  return {
    description: rate(stat.withDescription),
    date: rate(stat.withDate),
    country: rate(stat.withCountry),
    url: rate(stat.withUrl),
  };
}

/** The gate itself: a big-enough source below a floor is an incident. */
function fieldCoverageIncident(stat: IngestStats): string | undefined {
  if (stat.inSector < COVERAGE_MIN_JOBS) return undefined;
  if (stat.withDescription / stat.inSector < DESCRIPTION_FLOOR) {
    return `descriptions manquantes sur ${Math.round((1 - stat.withDescription / stat.inSector) * 100)}% des offres`;
  }
  if (stat.withUrl / stat.inSector < URL_FLOOR) {
    return `URL de candidature invalide/vide sur ${stat.inSector - stat.withUrl} offres`;
  }
  return undefined;
}

/**
 * What each source produced on its LAST recorded run.
 *
 * Read from SourceRun (the run-by-run history), taken before this run records
 * itself, so the baseline is genuinely the previous run — not this one. A source
 * with no history returns nothing and is treated as NEW.
 */
async function previousCounts(prisma: PrismaClient, sourceKeys: string[]): Promise<Map<string, { jobs: number; retention: RetentionBaseline | null }>> {
  // Most recent first; the first row seen per source is its last run.
  const rows = await prisma.sourceRun.findMany({
    where: { sourceKey: { in: sourceKeys } },
    orderBy: { ranAt: 'desc' },
    select: { sourceKey: true, jobs: true, fetched: true, accepted: true, runId: true },
  });
  // The guard's reference: only a row of a COMPLETE production RUN counts, never a targeted, canary or --source run.
  const runIds = [...new Set(rows.flatMap(row => row.runId ? [row.runId] : []))];
  const completeRuns = new Set(runIds.length ? (await prisma.pipelineEvent.findMany({
    where: { runId: { in: runIds }, event: FULL_RUN_MARKER }, select: { runId: true }, distinct: ['runId'] })).map(event => event.runId) : []);
  /**
   * La référence est le dernier run PRODUCTIF, pas le dernier run : après un
   * BROKEN (0), le run suivant à 0 se comparait à 0 et passait OK — 66 runs
   * « OK à 0 » sur 17 sources (Nordstrom 1 294 → 0, Rolex 208 → 0, Sephora
   * France 9 fois), le digest ne prévenait qu'une fois et le refresh fermait
   * leurs offres (audit A2, 2026-09-06). Une source qui a déjà tourné mais
   * n'a jamais produit vaut 0 : « toujours rien » reste une panne, pas un NEW.
   */
  const latest = new Map<string, number>();
  // The unpublished share of the last complete RUN that COLLECTED the source: a failed collection has no share.
  const retention = new Map<string, RetentionBaseline>();
  for (const row of rows) {
    const known = latest.get(row.sourceKey);
    if (known === undefined) latest.set(row.sourceKey, row.jobs);
    else if (known === 0 && row.jobs > 0) latest.set(row.sourceKey, row.jobs);
    if (!retention.has(row.sourceKey) && row.runId && completeRuns.has(row.runId) && (row.fetched ?? 0) > 0 && row.accepted != null)
      retention.set(row.sourceKey, { fetched: row.fetched!, accepted: row.accepted });
  }
  return new Map([...latest].map(([key, jobs]) => [key, { jobs, retention: retention.get(key) ?? null }]));
}

async function recordRun(prisma: PrismaClient, results: SourceHealth[], stats: IngestStats[]): Promise<void> {
  const now = new Date();
  await Promise.all(
    results.map(async (result) => {
      const stat = stats.find(s => s.source === result.source)!;
      await prisma.sourceRun.create({
        data: {
          sourceKey: result.source,
          ...(log.runId() ? { runId: log.runId() } : {}),
          status: result.status,
          jobs: result.jobs,
          previousJobs: result.previous,
          fetched: stat.fetched,
          complete: stat.complete ?? null,
          accepted: stat.inSector,
          declaredTotal: stat.declaredTotal ?? null,
          truncated: stat.truncated ?? false,
          errors: stat.errors,
          // A declared and proven empty listing is not an unexplained loss of
          // writes. The refresh still requires its archived posting-ID proof.
          canAttestAbsence: (result.previous !== null || isDeclaredEmptyEnumeration(stat)) && isTrustedForAttestation({
            status: result.status, complete: stat.complete, errors: stat.errors, truncated: stat.truncated,
            declaredTotal: stat.declaredTotal, fetched: stat.fetched, previous: result.previous,
          }) && (isDeclaredEmptyEnumeration(stat) || !(result.previous != null && result.previous > 0 && result.jobs < result.previous * COLLAPSE_RATIO)),
          // The coverage rates ride along on EVERY run, incident or not: they
          // are the trend the next regression gets caught against. Columns
          // carry the queryable numbers; the note stays human-readable.
          note: [result.note, result.coverage].filter(Boolean).join(' · ') || null,
          descriptionRate: result.rates?.description ?? null,
          dateRate: result.rates?.date ?? null,
          countryRate: result.rates?.country ?? null,
          urlRate: result.rates?.url ?? null,
          ranAt: now,
        },
      });
      // Denormalized onto the catalogue row too, so « how is this source
      // doing » is one query on Source (DEC-3).
      await recordSourceRunSummary(prisma, result.source, {
        status: result.status,
        jobs: result.jobs,
        descriptionRate: result.rates?.description,
        dateRate: result.rates?.date,
        countryRate: result.rates?.country,
        urlRate: result.rates?.url,
      });
    }),
  );

  // Keep the table bounded: history is for spotting a trend, not an archive.
  const stale = await prisma.sourceRun.findMany({
    where: { ranAt: { lt: new Date(now.getTime() - HISTORY * 86_400_000) } },
    select: { id: true },
    take: 5000,
  });
  if (stale.length > 0) {
    await prisma.sourceRun.deleteMany({ where: { id: { in: stale.map((row) => row.id) } } });
  }
}
