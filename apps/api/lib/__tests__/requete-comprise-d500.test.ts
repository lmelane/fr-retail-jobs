import { describe, expect, it } from 'vitest';
import v3 from '../../../../audits/2026-09-28/curation-v3/6-manifeste-v3.json' with { type: 'json' };
import sectors from '../../../../packages/db/data/sectors-v1.json' with { type: 'json' };
import { MARCHES } from '@catwalks/db/marches';
import type { OccupationManifest } from '@catwalks/db/occupations';
import { formesDeBase, replierRequete } from '@catwalks/db/search-comprendre';
import { snapshotModel, type SnapshotMetadata } from '../search-model';
import { RANG_METIER, RANG_TITRE, searchSql } from '../search-sql';
import { planifierRecherche } from '../search-plan';
import { exigerPerimetre } from '../perimetre';

/**
 * D-500 (Q1, Q4) — LA REQUÊTE COMPRISE, au seul client du contrat 2. Témoin pur, sur le manifeste v3 ACTIF en production
 * (`catwalks-occupations-20260929-v3`), par le vrai modèle et le vrai SQL. Les chiffres sur les offres réelles (au moins
 * 99 % des offres du métier pour « conseiller(ère) de vente ») se mesurent en production, en lecture seule
 * (`audits/2026-10-01/d500-requete/`) ; la chaîne jusqu'à la base, dans `suggestions-canoniques-d500.test.ts`.
 */
const manifest = v3 as unknown as OccupationManifest;
const model = snapshotModel({
  asOf: '2026-10-01T00:00:00.000Z', occupationRelease: { id: manifest.id, manifest },
  companies: [{ id: 'chanel', name: 'Chanel', parentGroup: null, parentGroupId: null, mergedIntoId: null, sectorCodes: [] }],
  aliases: [], sectorConcepts: sectors.map((s) => ({ code: s.code, labels: s.labels as Record<string, string> })),
} as SnapshotMetadata);
const compris = (q: string) => model.intention(q, MARCHES.FR, { comprendre: true });
const avant = (q: string) => model.intention(q, MARCHES.FR);
const roles = (i: ReturnType<typeof compris>) => i.clauses.filter((c) => c.kind === 'role').flatMap((c) => c.keys);
const textes = (i: ReturnType<typeof compris>) => i.clauses.filter((c) => c.kind === 'text').map((c) => c.observed);

/** Les 39 formes de la mesure du 01/10/2026 (`audits/2026-10-01/d500-requete/resultats/taxonomie.txt`). */
const FORMES: [string, string][] = [
  ['conseiller de vente', 'sales-advisor'], ['conseillère de vente', 'sales-advisor'], ['conseillere de vente', 'sales-advisor'],
  ['CONSEILLERE DE VENTE', 'sales-advisor'], ['conseillers de vente', 'sales-advisor'], ['conseillères de vente', 'sales-advisor'],
  ['conseiller(ère) de vente', 'sales-advisor'], ['conseiller/conseillère de vente', 'sales-advisor'], ['conseiller·ère de vente', 'sales-advisor'],
  ['conseiller.e de vente', 'sales-advisor'], ['conseillère', 'sales-advisor'], ['vendeur', 'sales-advisor'], ['vendeuse', 'sales-advisor'],
  ['vendeuses', 'sales-advisor'], ['vendeur(se)', 'sales-advisor'], ['vendeur/vendeuse', 'sales-advisor'], ['sales advisor', 'sales-advisor'],
  ['sales advisors', 'sales-advisor'], ['client advisor', 'sales-advisor'], ['conseillère de vente luxe', 'sales-advisor'],
  ['CONSEILLER DE VENTE /NB', 'sales-advisor'], ['conseillère de vente CDD', 'sales-advisor'], ['conseillère de vente H/F', 'sales-advisor'],
  ['conseillère de vente Toulouse', 'sales-advisor'], ['conseillère de vente expérimentée', 'sales-advisor'],
  ['responsable de boutique', 'store-manager'], ['responsable boutique', 'store-manager'], ['directrice de magasin', 'store-manager'],
  ['directeur de magasin', 'store-manager'], ['directrice de boutique', 'store-manager'], ['store manager', 'store-manager'],
  ['store managers', 'store-manager'], ['make-up artist', 'makeup-artist'], ['make up artist', 'makeup-artist'], ['makeup artist', 'makeup-artist'],
  ['maquilleuse', 'makeup-artist'], ['maquilleur', 'makeup-artist'], ['conseillère beauté', 'beauty-consultant'], ['visual merchandiser', 'visual-merchandiser'],
];

describe('D-500 (Q1) : la requête comprise', () => {
  it('PRÉMISSE : sans le contrat 2, les quatre formes du défaut ne trouvent pas le métier (mesure du 01/10/2026 : 34 sur 39)', () => {
    const trouvees = FORMES.filter(([f, m]) => roles(avant(f)).includes(m)).length;
    expect(trouvees).toBe(34);
    expect(textes(avant('conseiller(ère) de vente'))).toEqual(['conseiller', 'ere', 'de', 'vente']);
    expect(textes(avant('CONSEILLER DE VENTE /NB'))).toEqual(['nb']);
    expect(textes(avant('conseillère de vente H/F'))).toEqual(['h', 'f']);
  });

  it('38 formes sur 39 trouvent le métier attendu ; « conseillère » seul reste un mot, élargi à « conseiller »', () => {
    const manquees = FORMES.filter(([f, m]) => !roles(compris(f)).includes(m)).map(([f]) => f);
    expect(manquees).toEqual(['conseillère']);
    const seul = compris('conseillère').clauses;
    expect(seul).toHaveLength(1);
    expect(seul[0]).toMatchObject({ kind: 'text', phrases: ['conseillere', 'conseiller'] });
  });

  it('aucune clause de marque ou de terminaison : « ere », « e », « se », « nb », « h », « f », « m », « w », « d »', () => {
    const interdits = new Set(['ere', 'e', 'se', 'nb', 'h', 'f', 'm', 'w', 'd', 'x', 'in']);
    for (const [f] of FORMES) expect(textes(compris(f)).filter((t) => interdits.has(t)), f).toEqual([]);
    for (const f of ['Assistant Store Manager (m/w/d)', 'Vendeur (H/F/X)', 'conseillère de vente F/H', 'Verkäufer*in', 'Assistant(e) chef de projet'])
      expect(textes(compris(f)).filter((t) => interdits.has(t)), f).toEqual([]);
  });

  it('les mots qui ont un sens restent obligatoires : luxe, contrat, ville, niveau (comme Indeed)', () => {
    expect(textes(compris('conseillère de vente luxe'))).toEqual(['luxe']);
    expect(textes(compris('conseillère de vente CDD'))).toEqual(['cdd']);
    expect(textes(compris('conseillère de vente Toulouse'))).toEqual(['toulouse']);
    expect(textes(compris('conseillère de vente expérimentée'))).toEqual(['experimentee']);
  });

  it('le repliement n’agit que sur une écriture inclusive reconnue', () => {
    expect(replierRequete('conseiller(ère) de vente')).toBe('conseiller de vente');
    expect(replierRequete('Conseiller.e.s de vente')).toBe('Conseiller de vente');
    expect(replierRequete('directeur/rice adjoint/e')).toBe('directeur adjoint');
    expect(replierRequete('Directeur/Directrice de magasin')).toBe('Directeur de magasin');
    expect(replierRequete('CONSEILLER DE VENTE /NB')).toBe('CONSEILLER DE VENTE');
    expect(replierRequete('Assistant Store Manager /d)')).toBe('Assistant Store Manager');
    // Jamais : un mot composé, deux métiers distincts, un domaine, un contrat entre parenthèses.
    expect(replierRequete('make-up artist')).toBe('make-up artist');
    expect(replierRequete('styliste/modéliste')).toBe('styliste/modéliste');
    expect(replierRequete('linked.in')).toBe('linked.in');
    expect(replierRequete('Conseiller de vente (stage)')).toBe('Conseiller de vente (stage)');
    expect(replierRequete('R&D')).toBe('R&D');
    // Deux mots au début commun qui ne sont pas deux genres d'un même mot restent deux mots (audit technique).
    expect(replierRequete('communication/community manager')).toBe('communication/community manager');
    expect(replierRequete('commercial/communication')).toBe('commercial/communication');
    expect(replierRequete('marketing/marketplace')).toBe('marketing/marketplace');
    expect(roles(compris('communication/community manager'))).toEqual(roles(avant('communication/community manager')));
  });

  it('une forme de base n’est ajoutée que si le vocabulaire des métiers la connaît (« paris » ne devient pas « pari »)', () => {
    expect(formesDeBase('paris')).toContain('pari');
    expect(compris('paris').clauses[0].phrases).toEqual(['paris']);
    expect(compris('directrice').clauses[0].phrases).toEqual(['directrice', 'directeur']);
    expect(compris('vendeuses chanel').clauses.map((c) => c.kind)).toEqual(['role', 'company']);
    expect(compris('responsables').clauses[0].phrases).toEqual(['responsables', 'responsable']);
  });

  it('les mots de liaison : « responsable boutique » est le Responsable de boutique, sans aucun métier gagné par collision', () => {
    expect(roles(avant('responsable boutique'))).toEqual([]);
    const c = compris('responsable boutique cosmétique').clauses;
    expect(c.map((x) => x.kind)).toEqual(['role', 'text']);
    expect(c[0].keys).toEqual(['store-manager']);
    // La forme raccourcie tapée reste une expression : une offre sans métier qui l'écrit est trouvée.
    expect(c[0].phrases).toContain('responsable boutique');
    // Une forme raccourcie qui désignerait deux concepts n'est pas ajoutée ; aucune ne désigne un métier.
    const collisions = model.resolverCompris.liaisonsEnCollision;
    for (const cp of collisions) expect(model.resolverCompris.resolve(cp).clauses.some((x) => x.kind === 'role' && x.observed === cp)).toBe(false);
    expect(collisions.length).toBeLessThan(5);
  });

  it('sans le contrat 2, la lecture d’avant à l’identique, pour chaque forme', () => {
    for (const [f] of FORMES) expect(model.intention(f, MARCHES.FR)).toEqual(model.langues.restreindre(model.resolver.resolve(f), MARCHES.FR));
    // Le résolveur des intitulés (classification, documents) ne change pas : il ne lit jamais « responsable boutique ».
    expect(model.resolver.titleConcepts('Responsable boutique').roles).toEqual([]);
    // PRÉMISSE : avec les liaisons facultatives, « Conseil vente » se lirait comme la famille du conseil de vente ; le
    // document d'une offre ainsi intitulée n'en porte pourtant aucune (le résolveur des documents est celui d'avant).
    expect(model.resolverCompris.titleConcepts('Conseil vente').families).toEqual(['retail-client-advisor']);
    expect(model.document({ id: 'x', title: 'Conseil vente', countryCode: 'FR' }).families).toEqual([]);
  });

  it('une requête faite de seules marques reste lue telle quelle (jamais une recherche vide de sens)', () => {
    expect(textes(compris('H/F'))).toEqual(['h', 'f']);
  });
});

describe('D-500 (Q4) : le classement par l’intitulé, au seul contrat 2', () => {
  it('sans l’option, le score d’avant ; avec, le rang par l’intitulé puis par le métier, la condition inchangée', () => {
    const i = compris('conseillère de vente');
    const sans = searchSql(i), avec = searchSql(i, { classement: true });
    expect(sans.condition).toEqual(avec.condition);
    expect(sans.score.sql).not.toContain('CASE WHEN s.vector @@ (to_tsquery');
    expect(avec.score.sql).toContain('CASE WHEN s.vector @@');
    expect(avec.score.values).toEqual(expect.arrayContaining([RANG_TITRE, RANG_METIER]));
    // L'intitulé est lu au seul poids A : chaque expression du métier gardée pour le marché.
    expect(avec.score.values.filter((v) => typeof v === 'string').some((v) => (v as string).includes("'conseiller':A <-> 'de':A <-> 'vente':A"))).toBe(true);
    // Une exclusion ou une Maison ne compte pas pour l'intitulé.
    const chanel = searchSql(compris('vendeur chez chanel sans cdd'), { classement: true });
    // Les requêtes du rang : celles au seul poids A (la pertinence porte les poids AC et AB).
    const titre = chanel.score.values.filter((v) => typeof v === 'string' && /':A(?![A-Z])/.test(v as string)) as string[];
    expect(titre.length).toBe(1);
    expect(titre.join(' ')).not.toContain('chanel');
    expect(titre.join(' ')).not.toContain('cdd');
  });

  it('le plan ne porte la compréhension qu’au client qui l’annonce ; l’empreinte d’avant sinon', () => {
    const p = exigerPerimetre('FR');
    expect(planifierRecherche(p, { q: 'vendeur', filtres: {} })).not.toHaveProperty('comprendre');
    expect(planifierRecherche(p, { q: 'vendeur', filtres: {}, comprendre: true }).comprendre).toBe(true);
  });
});
