import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { previewRegistry, type RegistrySource } from '../../../src/registry/explicitRegistry.js';

/**
 * D-520 §2 — le fichier relu du 02/10/2026 confronté, hors réseau, à la photographie de production du même jour
 * (`audits/2026-10-02/registre-explicite/`, lecture seule). L'aperçu doit le prendre tel quel : complet (131 sources non
 * ACTIVE, aucune oubliée), sans statut changé, une seule sortie de statut (miu-miu, homonyme prouvé le 24/09).
 */
const dir = fileURLToPath(new URL('../../../../../audits/2026-10-02/registre-explicite/', import.meta.url));
const plan = JSON.parse(readFileSync(`${dir}registre-explicite-2026-10-02.json`, 'utf8'));
const snapshot = JSON.parse(readFileSync(`${dir}registre-2026-10-02.json`, 'utf8')) as Array<{ key: string; status: RegistrySource['status']; note: string | null; activeJobs: number }>;
const sources: RegistrySource[] = snapshot.map(s => ({ key: s.key, status: s.status, note: s.note, statusIntention: null, statusTrajectory: null,
  statusBasis: null, statusDecision: null, statusReason: null, statusNextAction: null, statusQuestion: null, statusReviewAt: null,
  statusExplainedFor: null, statusReviewId: null, activeJobs: s.activeJobs }));

describe('registre explicite du 02/10/2026', () => {
  it('prémisse : la photographie compte 543 sources dont 131 non ACTIVE (14 PAUSED, 117 RETIRED, aucune DRAFT ni VALIDATED)', () => {
    const count = (st: string) => snapshot.filter(s => s.status === st).length;
    expect([snapshot.length, count('ACTIVE'), count('PAUSED'), count('RETIRED'), count('DRAFT') + count('VALIDATED')]).toEqual([543, 412, 14, 117, 0]);
  });
  it("l'aperçu hors réseau ne refuse rien : chaque source non ACTIVE a exactement une explication", () => {
    const preview = previewRegistry(plan, sources);
    expect(preview.refused).toEqual([]);
    expect(preview.plan.entries).toHaveLength(131);
    expect(preview.retirements).toEqual([{ key: 'miu-miu', from: 'PAUSED', activeJobs: 7 }]);
  });
  it('chaque pause a sa date de réexamen, chaque revue humaine sa question', () => {
    for (const e of plan.entries) {
      if (e.targetStatus === 'PAUSED') expect(e.reviewAt, e.key).toMatch(/^2026-10-\d\d$/);
      if (e.trajectory === 'REVUE_HUMAINE') expect(e.question, e.key).toMatch(/\?/);
    }
  });
});
