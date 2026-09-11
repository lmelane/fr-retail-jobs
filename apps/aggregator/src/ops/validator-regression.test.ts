import { execFileSync } from 'node:child_process';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { classifyLabel } from '../lib/candidateChecks.js';

/**
 * The validator-correction scenario, locked so it cannot silently stop demonstrating anything.
 *
 * Two distinct failures would make the scenario worthless, and each has a test:
 *   - the corrected validator regresses, and one of the reviewed outcomes changes;
 *   - the two versions stop differing at all, so the script reports success while proving nothing.
 *
 * Running the script itself (rather than re-deriving its logic here) is the point: a test that re-implemented the
 * comparison would pass even if the script were broken.
 */
const REPO = resolve(fileURLToPath(new URL('.', import.meta.url)), '../../../..');
const SCRIPT = join(REPO, 'apps/aggregator/scripts/ops/validator-regression.mts');

/** Without `--reviews` the script needs no database, so it runs in the unit suite. */
const run = () => JSON.parse(execFileSync('npx', ['tsx', SCRIPT], { cwd: REPO, encoding: 'utf8' }));

describe('validator correction scenario', () => {
  it('reports the correction as effective, with no reviewed outcome contradicted', () => {
    const out = run();
    expect(out.verdict).toBe('CORRECTION_EFFECTIVE');
    expect(out.correctedVersionWrongOn).toEqual([]);
    expect(out.decisionsChanged).toBeGreaterThan(0);
  });

  it('changes the decision on the labels the correction was made for', () => {
    // The real history: before the correction each of these was OTHER, which alone refuses SINGLE_BRAND.
    expect(classifyLabel('KnitWell', 'KnitWell Group')).toBe('OWNER_ENTITY');
    expect(classifyLabel('VF Outdoor, LLC', 'VF Corporation')).toBe('OWNER_ENTITY');
  });

  it('still refuses a generic word and a different brand — the correction did not over-accept', () => {
    expect(classifyLabel('Group', 'KnitWell Group')).toBe('OTHER');
    expect(classifyLabel('GU USA LLC', 'UNIQLO')).toBe('OTHER');
  });
});
