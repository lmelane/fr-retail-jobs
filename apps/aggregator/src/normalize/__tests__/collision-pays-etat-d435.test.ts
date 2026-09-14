import { describe, it, expect } from 'vitest';
import { countryFromLocation } from '../country.js';

/**
 * D-435 LOT 1 — UN CODE D'ÉTAT N'EST PAS UN CODE PAYS.
 *
 * ── LE DÉFAUT, MESURÉ EN PRODUCTION LE 14/09/2026 ─────────────────────────
 *
 * 176 offres `l-oreal-professionnel` portaient un code d'ÉTAT AMÉRICAIN dans
 * le champ PAYS, et AUCUNE n'était signalée (`countryIntegrity` nul) :
 *
 *     stocké   lieu réel               lu comme
 *     IN       Indianapolis, IN        Inde
 *     KY       Florence, KY            Îles Caïmans
 *     AR       North Little Rock, AR   Argentine
 *     VA       Richmond, VA            Vatican
 *     MA       Attleboro, MA           Maroc
 *     IL       Champaign, IL           Israël
 *
 * ── POURQUOI LE GARDE EXISTANT NE SUFFISAIT PAS ───────────────────────────
 *
 * `geography.ts` porte une garde de collision soignée (`COLLIDING_CODES`,
 * 29 codes) qui, faute de preuve indépendante, **s'abstient** — le bon
 * comportement. Ces offres viennent d'Avature, dont la charge utile est
 * réduite à `{source}` : aucune preuve indépendante, donc abstention.
 *
 * Mais `upsert.ts:426` appelle ENSUITE `countryFromLocation` en repli, et
 * cette fonction lisait le dernier segment du libellé **sans aucune garde**.
 * Elle défaisait donc l'abstention prudente de la fonction précédente.
 *
 * **Une chaîne de résolution ne vaut que par son maillon le plus permissif.**
 *
 * ── CE QUE LE CEO A EXIGÉ, ET QUI CADRE CE CORRECTIF ──────────────────────
 *
 * « Ne PAS remplacer globalement MA, IN, IL, CA par des États américains. Ces
 * codes peuvent désigner autre chose dans une autre source. » Ce correctif
 * n'affirme donc JAMAIS « c'est un État » : il **refuse de conclure** quand le
 * libellé ressemble à une adresse américaine et que le code collisionne. Les
 * cas ambigus restent sans pays, jamais affectés à tort.
 */
describe('un code d’État américain ne devient pas un pays (D-435)', () => {
  it('PRÉMISSE : ces codes SONT bien des codes pays ISO valides', () => {
    // Sans cette assertion, le témoin pourrait passer au vert simplement
    // parce que le code n'est reconnu par rien — il ne testerait alors rien.
    for (const pays of ['Argentine', 'Inde', 'Maroc', 'Israël']) {
      expect(countryFromLocation(pays), `${pays} doit être reconnu comme pays`).toBeTruthy();
    }
  });

  it('« North Little Rock, AR » n’est PAS l’Argentine', () => {
    expect(countryFromLocation('North Little Rock, AR')).not.toBe('AR');
  });

  it('les six cas mesurés en production ne rendent plus un pays étranger', () => {
    const cas: ReadonlyArray<readonly [string, string]> = [
      ['Indianapolis, IN', 'IN'],
      ['Florence, KY', 'KY'],
      ['North Little Rock, AR', 'AR'],
      ['Richmond, VA', 'VA'],
      ['Attleboro, MA', 'MA'],
      ['Champaign, IL', 'IL'],
    ];
    for (const [libelle, faux] of cas) {
      expect(countryFromLocation(libelle), `« ${libelle} » ne doit pas rendre ${faux}`).not.toBe(faux);
    }
  });

  it('ABSTENTION, jamais invention : on ne rend pas « US » non plus', () => {
    /*
     * Le CEO : « ne pas remplacer globalement ces codes par des États ». Le
     * libellé seul ne PROUVE pas les États-Unis — « Florence, KY » pourrait
     * théoriquement être autre chose. On refuse de conclure, on n'invente pas
     * l'inverse. Le pays sera posé par une preuve indépendante, ou pas du tout.
     */
    expect(countryFromLocation('Florence, KY')).toBeUndefined();
    expect(countryFromLocation('Richmond, VA')).toBeUndefined();
  });

  it('un vrai pays nommé en toutes lettres passe TOUJOURS', () => {
    // Le correctif ne doit pas casser la lecture légitime.
    expect(countryFromLocation('Paris, France')).toBe('FR');
    expect(countryFromLocation('Berlin, Germany')).toBe('DE');
    expect(countryFromLocation('Milano, Italia')).toBe('IT');
  });

  it('un code pays NON collisionnant passe toujours', () => {
    // `FR`, `GB`, `JP` ne sont pas des États américains : rien ne change.
    expect(countryFromLocation('Paris, FR')).toBe('FR');
    expect(countryFromLocation('London, GB')).toBe('GB');
    expect(countryFromLocation('Tokyo, JP')).toBe('JP');
  });

  it('un code collisionnant SANS contexte américain reste lu comme un pays', () => {
    /*
     * La garde ne doit mordre que sur une forme d'ADRESSE américaine
     * (« Ville, XX »). Un code seul, ou une forme préfixée explicite, garde
     * son sens de pays — sinon on casserait les offres marocaines et indiennes
     * pour réparer les américaines.
     */
    expect(countryFromLocation('MA')).toBe('MA');
    expect(countryFromLocation('Casablanca, Maroc')).toBe('MA');
    expect(countryFromLocation('Mumbai, India')).toBe('IN');
  });

  it('une subdivision NON américaine prouve que le dernier segment est un pays', () => {
    /*
     * C'est le critère qui remplace la liste de « pays majeurs » — laquelle
     * contenait `IN` et rouvrait « Indianapolis, IN ». Ici, rien n'arbitre
     * entre deux pays : la STRUCTURE du libellé tranche. `BY` (Bavière),
     * `ON` (Ontario), `QC` (Québec) ne sont pas des États américains, donc le
     * segment final est bien un pays.
     */
    expect(countryFromLocation('Munich, BY, de')).toBe('DE');
    expect(countryFromLocation('Toronto, ON, CA')).toBe('CA');
    expect(countryFromLocation('Montreal, QC, CA')).toBe('CA');
  });

  it('« Ville, XX » sans autre indice reste INDÉCIDABLE, y compris « Berlin, DE »', () => {
    /*
     * PRÉMISSE — sans cette assertion, le témoin ne prouverait rien : il faut
     * que `DE` soit réellement à la fois un État et un pays, sinon le cas
     * n'exerce pas l'ambiguïté qu'on prétend traiter.
     */
    expect(countryFromLocation('Germany')).toBe('DE');

    /*
     * CONSÉQUENCE ASSUMÉE, À NE PAS « RÉPARER » PAR UNE LISTE. « Berlin, DE »
     * et « Wilmington, DE » sont structurellement identiques : une ville, un
     * code à deux lettres, aucun autre indice. Aucun code ne peut les
     * distinguer sans preuve externe.
     *
     * La chaîne consulte le champ pays déclaré et `geography.ts` AVANT ce
     * repli : une offre allemande correctement renseignée garde son pays. Ce
     * maillon ne fait que refuser d'inventer quand il est le dernier recours.
     */
    expect(countryFromLocation('Berlin, DE')).toBeUndefined();
    expect(countryFromLocation('Wilmington, DE')).toBeUndefined();
  });

  it('la forme préfixée « FR-75-Paris » reste lue correctement', () => {
    /*
     * `countryFromLocation` lit un segment `XX-YYY` (ligne ~190). Le témoin
     * initial utilisait « US-PA-Philadelphia » et échouait AVANT le correctif :
     * la découpe se fait sur les virgules, donc ce libellé n'a qu'UN segment,
     * « US-PA-Philadelphia », qui ne correspond pas au motif `^XX-YYY$`.
     *
     * Ce n'était donc pas un défaut à corriger mais un témoin mal construit :
     * cette forme-là est résolue plus haut dans la chaîne, par `geography.ts`.
     * Le témoin garde ce qui est VRAIMENT du ressort de cette fonction.
     */
    expect(countryFromLocation('Paris, FR-75')).toBe('FR');
  });
});
