import { describe, it, expect } from 'vitest';
import {
  decideMode, mayCloseOnAbsence, publishes, collectsAutomatically,
  OPERATIONAL_MODES, type SourceEvidence,
} from './operationalMode.js';

/**
 * CE QUE CES TESTS PROTÈGENT.
 *
 * Le droit de FERMER une offre est le pouvoir le plus destructeur du pipeline : il retire du catalogue des
 * postes que le candidat pourrait pourvoir. P4 et P7 ont établi qu'il ne s'accorde que sur un PARCOURS
 * DÉMONTRÉ — ni un statut de catalogue, ni un ratio, ni un volume de référence.
 *
 * Le piège précis que la règle ferme : `status = ACTIVE` dit qu'une source appartient au périmètre, jamais
 * qu'elle a vu le board entier. Les confondre fait fermer des offres vivantes parce qu'un passage instable
 * ne les a pas revues.
 */
const SAINE: SourceEvidence = {
  key: 'exemple', status: 'ACTIVE', hasConfig: true,
  identityVerified: true, identityHashMatchesConfig: true, accessAllowed: true,
  tenantKey: 'phenom:careers.exemple.com',
  lastRunStatus: 'OK', lastRunComplete: true, lastRunCanAttestAbsence: true,
  lastRunAt: new Date('2026-09-14T06:00:00Z'),
};

describe('mode opérationnel — le cas nominal', () => {
  it('accorde FULL_AUTOMATION quand TOUTES les conditions sont démontrées', () => {
    const d = decideMode(SAINE);
    expect(d.mode).toBe('FULL_AUTOMATION');
    expect(mayCloseOnAbsence(d.mode)).toBe(true);
  });

  it('toute décision porte un motif ET une prochaine action — aucune source « à vérifier »', () => {
    const cas: SourceEvidence[] = [
      SAINE,
      { ...SAINE, status: 'PAUSED' },
      { ...SAINE, hasConfig: false },
      { ...SAINE, accessAllowed: false },
      { ...SAINE, identityVerified: false },
      { ...SAINE, identityHashMatchesConfig: false },
      { ...SAINE, lastRunStatus: null },
      { ...SAINE, lastRunStatus: 'BROKEN' },
      { ...SAINE, lastRunComplete: false },
      { ...SAINE, lastRunCanAttestAbsence: false },
      { ...SAINE, tenantKey: null },
    ];
    for (const c of cas) {
      const d = decideMode(c);
      expect(OPERATIONAL_MODES).toContain(d.mode);
      expect(d.reasons.length).toBeGreaterThan(0);
      expect(d.nextAction.trim().length).toBeGreaterThan(0);
    }
  });
});

describe('mode opérationnel — le droit de fermer ne s\'accorde que sur preuve', () => {
  it('une énumération NON prouvée retire le droit de fermer, mais laisse publier', () => {
    // Le cas Hugo Boss / Skechers : pagination instable, `complete = false`. Les offres sont réelles et
    // doivent être publiées ; leur absence d'un passage ne prouve rien.
    const d = decideMode({ ...SAINE, lastRunComplete: false });
    expect(d.mode).toBe('PUBLISH_NO_CLOSE');
    expect(mayCloseOnAbsence(d.mode)).toBe(false);
    expect(publishes(d.mode)).toBe(true);
  });

  it('un droit d\'attester refusé retire le droit de fermer', () => {
    expect(decideMode({ ...SAINE, lastRunCanAttestAbsence: false }).mode).toBe('PUBLISH_NO_CLOSE');
  });

  it('sans clé de tenant, on publie mais on ne ferme pas', () => {
    expect(decideMode({ ...SAINE, tenantKey: null }).mode).toBe('PUBLISH_NO_CLOSE');
  });

  it('`complete` ou `canAttestAbsence` à NULL ne vaut pas TRUE', () => {
    // Une information absente n'est pas une condition remplie : c'est exactement ainsi qu'on s'admet seul.
    expect(decideMode({ ...SAINE, lastRunComplete: null }).mode).toBe('PUBLISH_NO_CLOSE');
    expect(decideMode({ ...SAINE, lastRunCanAttestAbsence: null }).mode).toBe('PUBLISH_NO_CLOSE');
  });
});

describe('mode opérationnel — l\'identité conditionne la publication', () => {
  it('une identité non certifiée interdit de publier : on collecte pour PROUVER', () => {
    const d = decideMode({ ...SAINE, identityVerified: false });
    expect(d.mode).toBe('EVIDENCE_ONLY');
    expect(publishes(d.mode)).toBe(false);
    expect(collectsAutomatically(d.mode)).toBe(true);
  });

  it('une revue périmée par un changement de configuration ne vaut PAS revue (D59)', () => {
    // Le cas mesuré en P9 : `localePath` ajouté après la revue — l'empreinte ne couvre plus la config.
    const d = decideMode({ ...SAINE, identityHashMatchesConfig: false });
    expect(d.mode).toBe('EVIDENCE_ONLY');
    expect(d.reasons.join(' ')).toMatch(/périmée|D59/);
  });
});

describe('mode opérationnel — ce qui interdit toute collecte', () => {
  it('PAUSED, blocage nommé, config absente ou accès refusé ⇒ PAUSED_BLOCKED', () => {
    for (const c of [
      { ...SAINE, status: 'PAUSED' },
      { ...SAINE, blockedReason: 'tenant contesté' },
      { ...SAINE, hasConfig: false },
      { ...SAINE, accessAllowed: false },
    ]) {
      const d = decideMode(c);
      expect(d.mode).toBe('PAUSED_BLOCKED');
      expect(collectsAutomatically(d.mode)).toBe(false);
    }
  });

  it('une source PAUSED sans motif reçoit quand même une prochaine action', () => {
    expect(decideMode({ ...SAINE, status: 'PAUSED' }).nextAction).toMatch(/motif|reprise/);
  });
});

describe('mode opérationnel — un statut de run inconnu n\'autorise rien', () => {
  it('ne suppose jamais ce qu\'il ne sait pas lire', () => {
    const d = decideMode({ ...SAINE, lastRunStatus: 'QUELQUE_CHOSE_DE_NOUVEAU' });
    expect(d.mode).toBe('EVIDENCE_ONLY');
    expect(mayCloseOnAbsence(d.mode)).toBe(false);
  });

  it('un run absent n\'est pas un run sain', () => {
    expect(decideMode({ ...SAINE, lastRunStatus: null }).mode).toBe('EVIDENCE_ONLY');
  });
});
