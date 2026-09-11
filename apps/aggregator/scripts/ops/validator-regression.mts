/**
 * Apply TWO versions of a shared validator to the SAME archived evidence, and show where they disagree.
 *
 * This is the scenario a configuration change cannot cover: re-running an unchanged validator after editing
 * `Source.config` proves the config binding, not that a corrected control changes a decision.
 *
 * The control is `classifyLabel` (lib/candidateChecks), called by `scopeEvidence`, which certification uses to
 * decide whether a portal's native labels contradict SINGLE_BRAND. It has a real correction history: before
 * 2026-09-10 it compared labels without stripping the Maison's own legal form and without accepting a shorter
 * form, so "KnitWell" was ruled OTHER for the Maison "KnitWell Group" and "VF Outdoor, LLC" OTHER for "VF
 * Corporation" — each one enough to refuse a legitimate certification.
 *
 * The BEFORE version below is that earlier logic, kept here solely as the reference the corrected control is
 * compared against. The AFTER version is the maintained `classifyLabel` itself, imported — never a copy.
 *
 * Two bodies of evidence, both archived, neither re-fetched:
 *   - REVIEWED CASES, the labels whose outcome a human decided, with the decision expected of the corrected one;
 *   - STORED REVIEWS, the `SourceIdentityReview` statements written during B6, which record the native labels
 *     read at validation together with the class the validator gave each one AT THAT TIME. Replaying both
 *     versions over them shows the certifications that exist only because the control was corrected.
 *
 * usage: validator-regression.mts [--reviews]   (--reviews also replays the stored reviews; needs a database)
 * exit 0 = the two versions differ exactly where expected · exit 1 = they agree, or the corrected one is wrong
 */
import { classifyLabel } from '../../src/lib/candidateChecks.js';
import { resolveCompany } from '../../src/normalize/company.js';
import { normalizedEmployerName } from '../../src/normalize/employerName.js';

/** The validator as it behaved BEFORE the 2026-09-10 correction: exact identity, nothing else. */
function classifyLabelBefore(label: string, maison: string): 'OWNER' | 'OWNER_ENTITY' | 'OTHER' {
  const ownerKey = resolveCompany(maison).companyId;
  const ownerNorm = normalizedEmployerName(maison);
  if (resolveCompany(label).companyId === ownerKey || normalizedEmployerName(label) === ownerNorm) return 'OWNER';
  return 'OTHER';
}

/**
 * The archived evidence: labels actually read on those boards, with the Maison each was judged against.
 * `expected` is the decision the corrected validator must reach — stated from the reviewed outcome, not from
 * whatever the code happens to return.
 */
const ARCHIVE: Array<{ label: string; maison: string; expected: string; note: string }> = [
  { label: 'KnitWell', maison: 'KnitWell Group', expected: 'OWNER_ENTITY', note: 'shorter form of the Maison (B6 KnitWell, 2026-09-10)' },
  { label: 'VF Outdoor, LLC', maison: 'VF Corporation', expected: 'OWNER_ENTITY', note: "the Maison's own legal form is not part of its name (B6 VF)" },
  { label: "Chico's FAS", maison: "Chico's", expected: 'OWNER_ENTITY', note: 'legal suffix stripped' },
  { label: 'Group', maison: 'KnitWell Group', expected: 'OTHER', note: 'a generic word alone is never the Maison — the guard against over-accepting' },
  { label: 'GU USA LLC', maison: 'UNIQLO', expected: 'OTHER', note: 'a different brand: SINGLE_BRAND must stay contradicted (headquarters_us_Uniqlo)' },
];

const rows = ARCHIVE.map((c) => {
  const before = classifyLabelBefore(c.label, c.maison);
  const after = classifyLabel(c.label, c.maison);
  return { ...c, before, after, changed: before !== after, afterMatchesExpected: after === c.expected };
});

const changed = rows.filter((r) => r.changed);
const wrong = rows.filter((r) => !r.afterMatchesExpected);

/**
 * The stored reviews. Each statement ends with the labels as the validator classified them at validation time,
 * in the form `Label ×n [CLASS], … → VERDICT`. Re-classifying those same labels with both versions shows which
 * archived certifications the correction is responsible for: a SINGLE_BRAND verdict that the earlier version
 * would have refused, because one label it called OTHER is enough to contradict the scope.
 */
const REVIEW_LINE = /Native (?:employer )?labels read[^:]*:\s*(.+?)\s*→\s*([A-Z_]+)\.?\s*$/;
/**
 * Each entry is matched WHOLE, never split on commas: employer labels contain commas of their own
 * ("VF (Cambodia) Sourcing Co., Ltd."), and splitting on them invented fragments like "Ltd." that the validator
 * was then blamed for classifying OTHER. The `×n [CLASS]` terminator is what delimits an entry.
 */
const LABEL_ENTRY = /([^×]+?)\s*×(\d+)\s*\[([A-Z_]+)\]/g;

let reviewRows: any[] = [];
const archiveDisagreements: string[] = [];
if (process.argv.includes('--reviews')) {
  const { PrismaClient } = await import('@prisma/client');
  const p = new PrismaClient();
  try {
    const reviews: any[] = await p.$queryRaw`
      SELECT r."sourceKey", r.statement, s.maison FROM "SourceIdentityReview" r
      JOIN "Source" s ON s.key = r."sourceKey" WHERE r.statement ~ 'labels read' ORDER BY r."createdAt" DESC`;
    for (const r of reviews) {
      const m = REVIEW_LINE.exec(String(r.statement));
      if (!m) continue;
      const labels = [...m[1].matchAll(LABEL_ENTRY)];
      if (!labels.length) continue;
      const replayed = labels.map((l) => {
        // A label follows the previous entry's "], " — strip that separator, and the statement's own preamble
        // ("… robots ALLOWED HTTP 200): "), without touching the commas inside the label itself.
        const label = l[1].replace(/^[,;]\s*/, '').replace(/^.*\)\s*:\s*/, '').trim();
        const archivedClass = l[3];
        // The catalogue's own placeholder is not a native label; the validator short-circuits it either way.
        const before = archivedClass === 'CATALOGUE' ? 'CATALOGUE' : classifyLabelBefore(label, r.maison);
        const after = archivedClass === 'CATALOGUE' ? 'CATALOGUE' : classifyLabel(label, r.maison);
        return { label, archivedClass, before, after };
      });
      // The corrected version must reproduce the class the archive recorded; a divergence means the archived
      // proof no longer describes what the maintained control decides, and must be reviewed rather than trusted.
      for (const x of replayed) if (x.after !== x.archivedClass) archiveDisagreements.push(`${r.sourceKey}: "${x.label}" archived ${x.archivedClass}, corrected validator says ${x.after}`);
      const downgraded = replayed.filter((x) => x.after !== 'OTHER' && x.before === 'OTHER');
      if (!downgraded.length) continue;
      // Under the earlier version a label it calls OTHER contradicts SINGLE_BRAND; the archived verdict stands
      // only because the correction reclassified it.
      reviewRows.push({
        sourceKey: r.sourceKey, maison: r.maison, archivedVerdict: m[2],
        onlyCertifiedThanksToCorrection: m[2] === 'SINGLE_BRAND_CONSISTENT',
        reclassified: downgraded.map((x) => `${x.label}: ${x.before} → ${x.after} (archived ${x.archivedClass})`),
      });
    }
  } finally { await p.$disconnect(); }
}

const summary = {
  at: new Date().toISOString(), validator: 'classifyLabel (lib/candidateChecks)',
  reviewedCases: rows.length,
  decisionsChanged: changed.length, changedCases: changed.map((r) => `${r.label} / ${r.maison}: ${r.before} → ${r.after}`),
  unchangedByDesign: rows.filter((r) => !r.changed).map((r) => `${r.label} / ${r.maison}: ${r.after}`),
  correctedVersionWrongOn: wrong.map((r) => `${r.label} / ${r.maison}: expected ${r.expected}, got ${r.after}`),
  storedReviewsAffected: reviewRows.length,
  certificationsOwedToTheCorrection: reviewRows.filter((r: any) => r.onlyCertifiedThanksToCorrection).map((r: any) => r.sourceKey),
  storedReviews: reviewRows,
  archiveDisagreements,
  verdict: wrong.length ? 'CORRECTED_VERSION_DISAGREES_WITH_REVIEWED_OUTCOME' : changed.length ? 'CORRECTION_EFFECTIVE' : 'NO_DIFFERENCE',
};
console.log(JSON.stringify(summary, null, 1));
if (wrong.length || !changed.length) process.exit(1);
