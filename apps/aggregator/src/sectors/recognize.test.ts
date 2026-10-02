import { describe, expect, it } from 'vitest';
import { recognitionFingerprint, recognizeSectors as recognize, type NativeCategory, type SectorEmployer } from './recognize.js';
import { parseReviewedSectors, type ReviewedSector } from './reviewedReference.js';

// Les témoins automatiques ne lisent pas le fichier relu réel : ils passent leur propre relecture (vide par défaut).
const recognizeSectors = (s: SectorEmployer[], n: NativeCategory[], at: string, rows: ReviewedSector[] = []) => recognize(s, n, at, rows);
const HEADER = 'cle\tnom\tsecteurs\tsource\textrait\tverifie_le\tremarque';
const relu = (...lines: string[]) => parseReviewedSectors([HEADER, ...lines].join('\n'));

const at = '2026-10-02T12:00:00Z';
const row = (id: string, name: string, extra: Partial<SectorEmployer> = {}): SectorEmployer => ({
  id, name, canonicalKey: name.toUpperCase().replace(/[^A-Z0-9]+/g, '_'), kind: 'UNKNOWN', parentGroupId: null, parentGroup: null,
  domain: null, domainSource: null, sectorCodes: [], sectorEvidence: null, servies: 10, evidenceUrl: `https://x.example/${id}`, sources: [], labels: [], ...extra });
const native = (companyId: string, champ: NativeCategory['champ'], valeur: string, n: number): NativeCategory =>
  ({ companyId, sourceKey: 'src', champ, valeur, n, url: `https://ats.example/${companyId}` });
const reviewed = (code: string) => [{ code, source: 'https://maison.example/about', statement: 'relu', confidence: 'HIGH', basis: 'OFFICIAL_SOURCE', checkedAt: '2026-09-09T00:00:00Z' }];
const proposed = (r: ReturnType<typeof recognize>, id: string) => r.proposals.find(p => p.id === id);
const reason = (r: ReturnType<typeof recognize>, id: string) => r.abstentions.find(a => a.id === id)?.reason;

describe('D-519 — le secteur reconnu sur preuves seulement', () => {
  it('lit une catégorie native du vocabulaire, et seulement elle', () => {
    const r = recognizeSectors([row('a', 'Alpha'), row('b', 'Beta')],
      [native('a', 'industry', 'Apparel And Fashion', 40), native('b', 'industry', 'Luxury Goods And Jewelry', 40)], at);
    expect(proposed(r, 'a')?.codes).toEqual(['FASHION']);
    expect(r.manifest.companies.find(c => c.id === 'a')?.evidence[0]).toMatchObject({ basis: 'OFFICIAL_SOURCE', source: 'https://ats.example/a' });
    // « Luxury Goods & Jewelry » ne dit pas lequel des secteurs : l'offre reste inconnue, jamais devinée.
    expect(reason(r, 'b')).toBe('NO_EVIDENCE');
  });
  it("ne retient pas une valeur saisie sur une minorité d'offres", () => {
    const r = recognizeSectors([row('a', 'Alpha')], [native('a', 'industry', 'Cosmetics', 97), native('a', 'industry', 'Apparel And Fashion', 3)], at);
    expect(proposed(r, 'a')?.codes).toEqual(['BEAUTY']);
  });
  it("ne donne jamais « Retail » seul : l'offre sortirait des filtres de produit où, inconnue, elle reste « non précisé »", () => {
    const r = recognizeSectors([row('a', 'Alpha')], [native('a', 'industry', 'Retail', 97)], at);
    expect(reason(r, 'a')).toBe('RETAIL_ONLY');
    expect(r.manifest.companies).toEqual([]);
  });
  it("ne donne jamais de secteur à un groupe, ni aux entités qu'il porte", () => {
    const group = row('g', 'Groupe Luxe', { kind: 'UNKNOWN' }), brand = row('m', 'Maison', { parentGroup: 'Groupe Luxe' });
    const r = recognizeSectors([group, brand], [native('g', 'businessGroup', 'Selective Distribution', 50)], at);
    expect(reason(r, 'g')).toBe('GROUP');
    expect(proposed(r, 'g')).toBeUndefined();
    // L'entité d'un groupe qui est elle-même un groupe ne compte qu'une fois dans les abstentions.
    // Forme mesurée (« Beiersdorf s.a.s. » sous « Beiersdorf AG ») : la clé de l'entité, sans « SAS », est le nom du groupe.
    const src = [{ sourceKey: 's', maison: 'Groupe AG', portalScope: null }];
    const parent = row('p', 'Groupe AG', { sources: src }), child = row('c', 'Groupe AG s.a.s.', { sources: src });
    const twice = recognizeSectors([parent, child, row('x', 'Marque', { parentGroup: 'Groupe AG' })], [], at);
    expect(reason(twice, 'p')).toBe('GROUP'); // prémisse : la Maison est un groupe et l'entité lui est rattachée
    expect(twice.abstentions.filter(a => a.id === 'c')).toHaveLength(1);
  });
  it('laisse inconnue une Maison dont deux preuves nomment des secteurs de produit disjoints', () => {
    const r = recognizeSectors([row('a', 'Alpha')], [native('a', 'industry', 'Cosmetics', 30), native('a', 'sectors', 'fashion-1', 30)], at);
    expect(reason(r, 'a')).toBe('EVIDENCE_DISAGREES');
    // Retail est une activité de distribution : il s'ajoute à un secteur de produit sans le contredire.
    const ok = recognizeSectors([row('a', 'Alpha')], [native('a', 'industry', 'Retail', 30), native('a', 'sectors', 'fashion-1', 30)], at);
    expect(proposed(ok, 'a')?.codes).toEqual(['FASHION', 'RETAIL']);
  });
  it("donne à une société le secteur relu de la seule Maison qui porte son domaine officiel", () => {
    const maison = row('m', 'Maison', { domain: 'maison.example', sectorCodes: ['FOOTWEAR'], sectorEvidence: reviewed('FOOTWEAR') });
    const kids = row('k', 'Kids Store', { domain: 'maison.example', domainSource: 'manual' });
    const unsourced = row('u', 'Autre', { domain: 'maison.example', domainSource: null });
    const r = recognizeSectors([maison, kids, unsourced], [], at);
    expect(proposed(r, 'k')).toMatchObject({ codes: ['FOOTWEAR'], origins: [{ code: 'FOOTWEAR', origin: 'domain:m' }] });
    // Un domaine dont la provenance n'est pas connue ne prouve rien.
    expect(reason(r, 'u')).toBe('NO_EVIDENCE');
  });
  it("donne à l'entité rattachée par le registre les secteurs de sa Maison, sans en ajouter (garde de fusion)", () => {
    const maison = row('m', 'Maison', { sectorCodes: ['FASHION'], sectorEvidence: reviewed('FASHION'), sources: [{ sourceKey: 's', maison: 'Maison', portalScope: null }] });
    const entity = row('e', 'Maison Italia S.r.l.', { sources: [{ sourceKey: 's', maison: 'Maison', portalScope: null }] });
    const r = recognizeSectors([maison, entity], [native('e', 'industry', 'Retail', 50)], at);
    expect(proposed(r, 'e')?.codes).toEqual(['FASHION']);
  });
  it("décide une Maison et ses entités ensemble, sur les preuves de toutes", () => {
    const maison = row('m', 'Maison', { servies: 0, sources: [{ sourceKey: 's', maison: 'Maison', portalScope: null }] });
    const entity = row('e', 'Maison Italia S.r.l.', { sources: [{ sourceKey: 's', maison: 'Maison', portalScope: null }] });
    const r = recognizeSectors([maison, entity], [native('e', 'industry', 'Apparel And Fashion', 50)], at);
    expect(proposed(r, 'm')?.codes).toEqual(['FASHION']);
    expect(proposed(r, 'e')?.codes).toEqual(['FASHION']);
  });
  it("s'abstient pour une entité dont la Maison n'existe pas encore (la fusion dans une ligne sans secteur échouerait)", () => {
    const entity = row('e', 'Maison Italia S.r.l.', { sources: [{ sourceKey: 's', maison: 'Maison', portalScope: null }] });
    const r = recognizeSectors([entity], [native('e', 'industry', 'Apparel And Fashion', 50)], at);
    expect(reason(r, 'e')).toBe('MAISON_TO_CREATE');
  });
  it('lit la liste de référence pour un segment qui est un secteur, pas pour « Luxe » ni « Joaillerie-Horlogerie »', () => {
    const r = recognizeSectors([row('c', 'Caudalie'), row('t', 'Tiffany')], [], at);
    expect(proposed(r, 'c')).toMatchObject({ codes: ['BEAUTY'], origins: [{ origin: expect.stringMatching(/^reference:/) }] });
    expect(reason(r, 't')).toBe('NO_EVIDENCE');
  });
  it('garde la relecture : une erreur trouvée à la main reste inconnue', () => {
    const r = recognizeSectors([row('i', 'IZIPIZI', { canonicalKey: 'IZIPIZI' })], [native('i', 'sectors', 'fashion-1', 9)], at);
    expect(reason(r, 'i')).toBe('REFUSED_AT_REVIEW');
  });
  it("n'écrit rien sur une société déjà qualifiée", () => {
    const r = recognizeSectors([row('a', 'Alpha', { sectorCodes: ['BEAUTY'], sectorEvidence: reviewed('BEAUTY') })], [native('a', 'industry', 'Retail', 50)], at);
    expect(r.proposals).toEqual([]);
  });
  it("fige la relecture sur les secteurs et leurs preuves, pas sur l'adresse d'exemple ni l'heure", () => {
    const a = recognizeSectors([row('a', 'Alpha')], [native('a', 'industry', 'Cosmetics', 50)], at);
    const b = recognizeSectors([row('a', 'Alpha', { servies: 99 })], [{ ...native('a', 'industry', 'Cosmetics', 80), url: 'https://autre.example/x' }], '2026-10-03T00:00:00Z');
    expect(a.proposals).toHaveLength(1); // prémisse : une proposition existe, l'égalité ne compare pas deux vides
    expect(recognitionFingerprint(b.proposals)).toBe(recognitionFingerprint(a.proposals));
    const c = recognizeSectors([row('a', 'Alpha')], [native('a', 'industry', 'Apparel And Fashion', 50)], at);
    expect(recognitionFingerprint(c.proposals)).not.toBe(recognitionFingerprint(a.proposals));
  });
});

describe('D-519 — la relecture documentée des Maisons (data/reference/secteurs-relus.tsv)', () => {
  it('fait foi seule, avec son extrait, sa source et sa date ; sur le domaine officiel, entités comprises', () => {
    const rows = relu('domain:coach.example\tCoach\tFASHION|LEATHER_GOODS\thttps://en.wikipedia.org/wiki/Coach\t« handbags and ready-to-wear »\t2026-10-02\t');
    const coach = row('c', 'Coach', { domain: 'coach.example', domainSource: 'manual' });
    const entity = row('e', 'Coach Stores Inc.', { domain: 'coach.example', domainSource: 'logos' });
    const r = recognizeSectors([coach, entity], [native('c', 'industry', 'Retail', 50)], at, rows);
    expect(proposed(r, 'c')).toMatchObject({ codes: ['FASHION', 'LEATHER_GOODS'], origins: [{ origin: 'reviewed:domain:coach.example' }, { origin: 'reviewed:domain:coach.example' }] });
    expect(proposed(r, 'e')?.codes).toEqual(['FASHION', 'LEATHER_GOODS']);
    expect(r.manifest.companies[0].evidence[0]).toMatchObject({ basis: 'REFERENCE_LIST', checkedAt: '2026-10-02T00:00:00Z', source: 'https://en.wikipedia.org/wiki/Coach' });
    // Sans provenance de domaine, le domaine ne prouve pas l'identité.
    expect(reason(recognizeSectors([row('x', 'X', { domain: 'coach.example' })], [], at, rows), 'x')).toBe('NO_EVIDENCE');
  });
  it('lit une source du domaine de la Maison comme officielle', () => {
    const rows = relu('key:KEY|Alpha\tAlpha\tBEAUTY\thttps://www.alpha.example/about\t« skincare »\t2026-10-02\t');
    const r = recognizeSectors([row('a', 'Alpha', { canonicalKey: 'KEY', domain: 'alpha.example' })], [], at, rows);
    expect(r.manifest.companies[0].evidence[0]).toMatchObject({ basis: 'OFFICIAL_SOURCE', confidence: 'HIGH' });
  });
  it("une Maison relue et laissée INCONNU n'est qualifiée par aucune preuve automatique", () => {
    const rows = relu('key:KEY|Alpha\tAlpha\tINCONNU\thttps://en.wikipedia.org/wiki/Alpha\t« conglomerate »\t2026-10-02\tgroupe multisectoriel');
    const r = recognizeSectors([row('a', 'Alpha', { canonicalKey: 'KEY' })], [native('a', 'industry', 'Apparel And Fashion', 50)], at, rows);
    expect(reason(r, 'a')).toBe('REVIEWED_UNKNOWN');
  });
  it("refuse un fichier qui enfreint les règles de relecture plutôt que d'ignorer la ligne", () => {
    expect(() => relu('domain:a.example\tA\tRETAIL\thttps://a.example\t« stores »\t2026-10-02\t')).toThrow('RETAIL alone');
    expect(() => relu('domain:a.example\tA\tMODE\thttps://a.example\t« x »\t2026-10-02\t')).toThrow('unknown or duplicate sector');
    expect(() => relu('domain:a.example\tA\tFASHION\thttp://a.example\t« x »\t2026-10-02\t')).toThrow('https');
    expect(() => relu('domain:a.example\tA\tINCONNU\thttps://a.example\t« x »\t2026-10-02\t')).toThrow('reason');
    expect(() => relu('domain:a.example\tA\tFASHION\thttps://a.example\t« x »\t02/10/2026\t')).toThrow('verifie_le');
  });
  it('le fichier livré se lit sans erreur', () => {
    expect(recognize([], [], at).proposals).toEqual([]);
  });
});
