import { describe, it, expect } from 'vitest';
import {
  findOverlaps, decideVerdict, tenantCollision, normalizeActor, registrableDomain,
  ONBOARD_VERDICTS, type CatalogueView, type Dossier,
} from './reconcile.js';

/**
 * LE DÉFAUT RÉEL QUE CES TESTS VERROUILLENT.
 *
 * Vague 2 de P9 : sur douze dossiers, **cinq n'étaient pas des lacunes** — des marques déjà servies par un
 * portail de groupe, qu'une source par marque aurait dupliqué. C'est le cas D34, et il se reproduit à chaque
 * vague si le rapprochement est fait à l'œil plutôt que mesuré.
 *
 * Le jeu d'essai ci-dessous décrit un catalogue FICTIF choisi pour exercer chaque règle ; il ne prétend pas
 * refléter l'attribution réelle d'`oniverse`, qui publie sous une seule société (voir `reconcile.ts`).
 */
const CAT: CatalogueView = {
  tenantsByKey: new Map([['workday:tapestry/external', 'tapestry']]),
  sourcesByDomain: new Map([['hugoboss.com', 'hugo-boss-phenom']]),
  companiesWithOffers: new Map([['eric bompard', 34], ['calzedonia', 120], ['skechers', 1656]]),
  sourcesByCompany: new Map([['eric bompard', ['bompard']], ['skechers', ['skechers-phenom']]]),
  brandCoveredByGroup: new Map([
    ['calzedonia', 'oniverse'], ['intimissimi', 'oniverse'], ['tezenis', 'oniverse'],
  ]),
};

const base: Dossier = { acteur: 'Nouvelle Maison', type: 'MAISON', urlOfficielle: 'https://careers.nouvelle.com/' };

const SAIN = {
  dossier: base, overlaps: [], ats: 'phenom', adapterExists: true,
  portalProven: true, inSector: true, identityAmbiguous: false, technicalBlocker: null,
};

describe('rapprochement — les recouvrements qui évitent un doublon', () => {
  it('une marque servie par un portail de GROUPE bloque : c\'est le cas D34', () => {
    const o = findOverlaps({ ...base, acteur: 'CALZEDONIA' }, CAT);
    const g = o.find((x) => x.kind === 'MARQUE_COUVERTE_PAR_GROUPE');
    expect(g?.blocking).toBe(true);
    expect(g?.detail).toContain('oniverse');
    expect(decideVerdict({ ...SAIN, overlaps: o }).verdict).toBe('ALREADY_COVERED_BY_GROUP');
  });

  it('un domaine déjà catalogué bloque', () => {
    const o = findOverlaps({ ...base, urlOfficielle: 'https://careers.hugoboss.com/global/en' }, CAT);
    expect(o.find((x) => x.kind === 'SOURCE_DEJA_PRESENTE')?.blocking).toBe(true);
    expect(decideVerdict({ ...SAIN, overlaps: o }).verdict).toBe('ALREADY_COVERED_BY_SOURCE');
  });

  it('un acteur publiant déjà bloque un dossier « nouvel acteur »', () => {
    const o = findOverlaps({ ...base, acteur: 'Eric Bompard' }, CAT);
    expect(o.find((x) => x.kind === 'ACTEUR_DEJA_COUVERT')?.blocking).toBe(true);
  });

  it('mais un PORTAIL RÉGIONAL du même acteur ne bloque PAS — il complète', () => {
    // La distinction est le cœur du Bloc 4 : compléter une couverture n'est pas la dupliquer.
    const o = findOverlaps({ ...base, acteur: 'Skechers', type: 'PORTAIL_REGIONAL' }, CAT);
    const r = o.find((x) => x.kind === 'PORTAIL_REGIONAL_EXISTANT');
    expect(r?.blocking).toBe(false);
    expect(decideVerdict({ ...SAIN, overlaps: o }).verdict).toBe('REGIONAL_SOURCE_CANDIDATE');
  });

  it('un doublon de tenant se détecte AVANT toute écriture', () => {
    expect(tenantCollision('workday:tapestry/external', CAT)?.blocking).toBe(true);
    expect(tenantCollision('workday:inconnu/external', CAT)).toBeNull();
  });

  it('un dossier réellement nouveau ne produit aucun recouvrement', () => {
    expect(findOverlaps(base, CAT)).toEqual([]);
  });
});

describe('rapprochement — normalisation', () => {
  it('la forme juridique n\'est pas une identité', () => {
    expect(normalizeActor('Ulta Beauty, Inc.')).toBe(normalizeActor('ULTA BEAUTY'));
    expect(normalizeActor('Coach Stores Canada Corporation')).toContain('coach');
  });

  it('les accents et la casse ne distinguent pas deux acteurs', () => {
    expect(normalizeActor('L\'Oréal')).toBe(normalizeActor('L OREAL'));
  });

  it('le domaine enregistrable rapproche deux URLs du même portail', () => {
    expect(registrableDomain('https://careers.hugoboss.com/global/en')).toBe('hugoboss.com');
    expect(registrableDomain('https://www.hugoboss.com/')).toBe('hugoboss.com');
    expect(registrableDomain('pas une url')).toBeNull();
  });
});

describe('verdicts — l\'ordre de disqualification', () => {
  it('hors secteur prime : on ne prouve pas le portail d\'un acteur hors périmètre', () => {
    expect(decideVerdict({ ...SAIN, inSector: false, portalProven: false }).verdict).toBe('OUT_OF_SECTOR');
  });

  it('un ATS maîtrisé donne READY_CONFIG_ONLY — jamais un script par Maison', () => {
    const v = decideVerdict(SAIN);
    expect(v.verdict).toBe('READY_CONFIG_ONLY');
    expect(v.reason).toMatch(/configuration/);
  });

  it('un ATS reconnu SANS adaptateur demande un adaptateur, et ne bloque pas les autres dossiers', () => {
    expect(decideVerdict({ ...SAIN, ats: 'famille-inconnue', adapterExists: false }).verdict)
      .toBe('NEW_ADAPTER_REQUIRED');
  });

  it('un portail propriétaire sans ATS reste intégrable en HTML public', () => {
    expect(decideVerdict({ ...SAIN, ats: null }).verdict).toBe('READY_PUBLIC_HTML');
  });

  it('sans preuve de portail archivée, aucun verdict favorable (D60)', () => {
    // Le domaine ressemblant à celui de la Maison n'est PAS une preuve : c'est l'erreur de la vague 1.
    expect(decideVerdict({ ...SAIN, portalProven: false }).verdict).toBe('OFFICIAL_PORTAL_NOT_PROVEN');
  });

  it('une identité ambiguë ne s\'intègre pas', () => {
    expect(decideVerdict({ ...SAIN, identityAmbiguous: true }).verdict).toBe('IDENTITY_AMBIGUOUS');
  });

  it('un blocage technique nommé est un verdict, pas un silence', () => {
    const v = decideVerdict({ ...SAIN, technicalBlocker: 'WAF Amazon, rendu impossible' });
    expect(v.verdict).toBe('BLOCKED_TECHNICAL');
    expect(v.reason).toContain('WAF');
  });

  it('tout verdict rendu appartient à la liste fermée', () => {
    for (const c of [
      SAIN, { ...SAIN, inSector: false }, { ...SAIN, portalProven: false },
      { ...SAIN, ats: null }, { ...SAIN, identityAmbiguous: true },
      { ...SAIN, ats: 'x', adapterExists: false }, { ...SAIN, technicalBlocker: 'x' },
    ]) expect(ONBOARD_VERDICTS).toContain(decideVerdict(c).verdict);
  });
});

describe('rapprochement — un domaine d\'ÉDITEUR n\'identifie pas un employeur', () => {
  it('CLAIRE\'S sur myworkdayjobs.com n\'est PAS « déjà couverte » par une autre Maison Workday', () => {
    /**
     * Le défaut mesuré au Bloc 4 : tous les tenants Workday partagent `myworkdayjobs.com`. Rapprocher
     * dessus aurait bloqué TOUTE future Maison hébergée chez un éditeur déjà présent — la majorité des
     * dossiers.
     */
    const cat: CatalogueView = {
      tenantsByKey: new Map(),
      sourcesByDomain: new Map([['myworkdayjobs.com', 'une-autre-maison-workday']]),
      companiesWithOffers: new Map(), sourcesByCompany: new Map(), brandCoveredByGroup: new Map(),
    };
    const o = findOverlaps(
      { acteur: "CLAIRE'S", type: 'MAISON', urlOfficielle: 'https://claires.wd12.myworkdayjobs.com/Claires' }, cat);
    expect(o.find((x) => x.kind === 'SOURCE_DEJA_PRESENTE')).toBeUndefined();
  });

  it('mais un vrai domaine d\'employeur rapproche toujours', () => {
    const cat: CatalogueView = {
      tenantsByKey: new Map(), sourcesByDomain: new Map([['hugoboss.com', 'hugo-boss-phenom']]),
      companiesWithOffers: new Map(), sourcesByCompany: new Map(), brandCoveredByGroup: new Map(),
    };
    const o = findOverlaps(
      { acteur: 'HUGO BOSS', type: 'MAISON', urlOfficielle: 'https://careers.hugoboss.com/global/en' }, cat);
    expect(o.find((x) => x.kind === 'SOURCE_DEJA_PRESENTE')?.blocking).toBe(true);
  });

  it('la garde qui demeure sur un éditeur partagé est le DOUBLON DE TENANT', () => {
    const cat: CatalogueView = {
      tenantsByKey: new Map([['workday:claires/Claires', 'claires-existante']]),
      sourcesByDomain: new Map(), companiesWithOffers: new Map(),
      sourcesByCompany: new Map(), brandCoveredByGroup: new Map(),
    };
    expect(tenantCollision('workday:claires/Claires', cat)?.blocking).toBe(true);
  });
});
