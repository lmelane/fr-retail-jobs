import type { OccupationManifest } from '@catwalks/db/occupations';
import { searchWords, type SearchClause, type SearchIntent } from './search-intent';

/**
 * D-488 : LA RECHERCHE PAR MÉTIER GARDE LES VARIANTES DES LANGUES DU MARCHÉ.
 *
 * Sous la taxonomie v3, un métier porte ses libellés dans 25 langues. La requête d'un métier les embarquait tous
 * (« conseiller de vente » sur le marché français : 80 expressions, dont l'arabe, le thaï, le coréen), ce qui rendait la
 * recherche par métier environ deux fois plus lente pour aucun résultat de plus (mesure du 30/09/2026, D-488).
 *
 * Pour un marché, une expression du métier reste dans la requête si :
 *  1. c'est le libellé du métier dans une langue du marché (langues de ses locales, plus l'anglais : les offres de
 *     chaque marché s'écrivent aussi en anglais) ;
 *  2. c'est le libellé d'une autre langue, écrit uniquement avec des mots que les libellés des langues du marché
 *     emploient (le libellé italien « Sales Assistant » est de l'anglais : 23 offres françaises le portent) ;
 *  3. ce n'est le libellé d'aucune langue (variante relevée dans les offres, forme féminine, alias historique) et elle
 *     s'écrit dans les écritures des langues du marché (« Addetto vendite » reste en France ; « 販売スタッフ » non) ;
 *  4. c'est exactement ce que la personne a tapé : elle trouve toujours les mots qu'elle cherche.
 * Sans marché (périmètre d'un pays seul), la requête reste entière. Seules les clauses de métier sont concernées : la
 * décision porte sur elles. Une offre classée se trouve par l'identité de son métier, jamais par ces expressions ; elles
 * servent au classement (score) et à trouver par les mots une offre qui ne nomme aucun métier (`search-sql.ts`). La
 * mesure sur les documents réels dit ce que la restriction change pour un marché (`audits/2026-10-01/d488-langues-marche/`).
 */

/** La langue d'une étiquette (« pt-BR » → « pt », « zh-Hant » → « zh ») : les variantes régionales d'une langue vont ensemble. */
const langue = (etiquette: string) => etiquette.split('-')[0].toLowerCase();

/** Les langues d'un marché : celles de ses locales, et l'anglais. */
export function languesDuMarche(marche: { readonly locales: readonly string[] }): string[] {
  return [...new Set([...marche.locales.map(langue), 'en'])].sort();
}

const ECRITURES = ['Latin', 'Greek', 'Cyrillic', 'Armenian', 'Hebrew', 'Arabic', 'Devanagari', 'Thai', 'Hangul', 'Hiragana', 'Katakana', 'Han']
  .map((nom) => ({ nom, motif: new RegExp(`\\p{Script=${nom}}`, 'u') }));

/** Les écritures des lettres d'une expression déjà normalisée ; une lettre d'une autre écriture compte pour elle-même. */
function ecritures(expression: string): Set<string> {
  const vues = new Set<string>();
  for (const lettre of expression) {
    if (!/\p{L}/u.test(lettre)) continue;
    vues.add(ECRITURES.find((e) => e.motif.test(lettre))?.nom ?? `autre:${lettre}`);
  }
  return vues;
}

/**
 * Les écritures d'une langue (Unicode). Une table, et non les libellés du manifeste : un libellé resté en anglais dans
 * une autre langue (« Sales Assistant » en italien, relevé comme faute à la curation) ou mal écrit ne doit pas ouvrir une
 * écriture, et un manifeste sans libellé chinois (la v1) ne doit pas fermer le chinois au marché chinois.
 */
const ECRITURES_DES_LANGUES: Readonly<Record<string, readonly string[]>> = {
  zh: ['Han'], ja: ['Han', 'Hiragana', 'Katakana'], ko: ['Hangul', 'Han'], th: ['Thai'], ar: ['Arabic'], el: ['Greek'],
  he: ['Hebrew'], ru: ['Cyrillic'], uk: ['Cyrillic'], bg: ['Cyrillic'], sr: ['Cyrillic', 'Latin'], hy: ['Armenian'], hi: ['Devanagari'],
};
const ecrituresDeLaLangue = (l: string) => ECRITURES_DES_LANGUES[l] ?? ['Latin'];

const expression = (v: string) => searchWords(v).join(' ');
const inclus = <T>(a: Iterable<T>, b: ReadonlySet<T>) => [...a].every((x) => b.has(x));

export type LanguesDuVocabulaire = ReturnType<typeof languesDuVocabulaire>;

/**
 * Ce que le manifeste dit des langues : pour chaque métier, les langues de chacun de ses libellés ; pour chaque langue,
 * les mots et les écritures de tous ses libellés (métiers et familles). Calculé une fois par version du vocabulaire ;
 * la restriction d'un marché est mémorisée.
 */
export function languesDuVocabulaire(manifest: Pick<OccupationManifest, 'occupations' | 'families'>) {
  const libelles = new Map<string, Map<string, Set<string>>>();
  const mots = new Map<string, Set<string>>();
  for (const o of manifest.occupations) {
    const parExpression = new Map<string, Set<string>>();
    for (const [etiquette, v] of Object.entries(o.labels ?? {})) {
      const e = expression(v);
      if (e) parExpression.set(e, new Set([...(parExpression.get(e) ?? []), langue(etiquette)]));
    }
    libelles.set(o.key, parExpression);
  }
  for (const d of [...manifest.occupations, ...manifest.families]) for (const [etiquette, v] of Object.entries(d.labels ?? {})) {
    const l = langue(etiquette), e = expression(v);
    if (!e) continue;
    mots.set(l, new Set([...(mots.get(l) ?? []), ...e.split(' ')]));
  }
  const memo = new Map<string, (clause: SearchClause) => SearchClause>();

  /** La clause d'un métier réduite aux expressions des langues données ; toute autre clause, inchangée. */
  function pourLesLangues(langues: readonly string[]) {
    const cle = [...langues].sort().join(',');
    const deja = memo.get(cle);
    if (deja) return deja;
    const voulues = new Set(langues);
    const lexique = new Set([...voulues].flatMap((l) => [...(mots.get(l) ?? [])]));
    const permises = new Set([...voulues].flatMap(ecrituresDeLaLangue));
    const garde = (metier: string, p: string, tapee: string) => {
      if (p === tapee) return true;
      const de = libelles.get(metier)?.get(p);
      if (de?.size) return [...de].some((l) => voulues.has(l)) || inclus(p.split(' '), lexique);
      return inclus(ecritures(p), permises);
    };
    const restreindre = (c: SearchClause): SearchClause => {
      if (c.kind !== 'role' || c.keys.length !== 1 || !libelles.has(c.keys[0])) return c;
      const phrases = c.phrases.filter((p) => garde(c.keys[0], p, c.observed));
      // Jamais de clause vide : sans expression gardée (ce que le vocabulaire actuel ne produit pas), la clause reste entière.
      return phrases.length && phrases.length < c.phrases.length ? { ...c, phrases } : c;
    };
    memo.set(cle, restreindre);
    return restreindre;
  }

  return {
    pourLesLangues,
    /** L'intention restreinte aux langues du marché ; sans marché, l'intention telle quelle. */
    restreindre(intent: SearchIntent, marche: { readonly locales: readonly string[] } | undefined): SearchIntent {
      if (!marche) return intent;
      const r = pourLesLangues(languesDuMarche(marche));
      return { ...intent, clauses: intent.clauses.map(r) };
    },
  };
}
