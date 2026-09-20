import { describe, expect, it } from 'vitest';
import { parseSmartRecruitersPosting, type SmartRecruitersPosting } from '../../ats/adapters/smartrecruiters.js';
import { parseRecruiteeJob } from '../../ats/adapters/recruitee.js';
import { lvmhExperienceYears, personioExperienceYears } from '../experience.js';

/**
 * L4 — UN RANG DE SÉNIORITÉ NE DEVIENT JAMAIS UN NOMBRE D'ANNÉES.
 *
 * ── POURQUOI CE FICHIER EXISTE ─────────────────────────────────────────────────────────────────
 *
 * La règle est écrite et appliquée (`experience.ts`, en tête) : « la source dit un RANG → on ne
 * l'écrit PAS dans `experienceYears` ». Mais elle n'était gardée par AUCUN témoin côté
 * SmartRecruiters ni Recruitee — vérifié le 2026-09-20 : un rapport citait un test
 * `recruitee.test.ts:28` qui n'existe pas.
 *
 * Une règle non gardée est une régression en attente : il suffit qu'un jour quelqu'un trouve
 * dommage de « perdre » `mid_senior_level` et le mappe sur 5 ans. Le candidat qui filtre
 * « 5 ans d'expérience » verrait alors des offres qui n'en demandent pas — un chiffre inventé ne
 * se voit pas, contrairement à une case vide.
 *
 * ── CE QUE L'ÉCRITURE DES TÉMOINS A RÉVÉLÉ ─────────────────────────────────────────────────────
 *
 * Il n'existe AUCUN lecteur générique d'expérience : seulement `lvmhExperienceYears` et
 * `personioExperienceYears`, chacun adossé à une TABLE FERMÉE de durées déclarées par sa source.
 * C'est structurellement ce qui empêche un rang d'être converti — une valeur hors table rend
 * `undefined`. La garantie ne tient donc pas à une liste d'exclusion qu'on pourrait oublier
 * d'alimenter, mais à une liste d'INCLUSION. C'est plus solide, et il faut que les témoins le
 * disent.
 *
 * ── DEUX FAMILLES, VOLONTAIREMENT SÉPARÉES ─────────────────────────────────────────────────────
 *
 * · « ACCEPTATION » verrouille l'invariant qui ne doit pas changer.
 * · « comportement ACTUEL » décrit l'état des lieux, sans préjuger qu'il soit la cible : si la
 *   décision D-3 (brancher `Job.seniority`) est prise, ces témoins-là devront évoluer.
 */

/** Une offre SmartRecruiters minimale, portant le rang de séniorité de la source. */
function offreAvecRang(rang: string): SmartRecruitersPosting {
  return {
    id: `sr-l4-${rang}`,
    name: 'Client Advisor',
    releasedDate: '2026-09-01',
    location: { country: 'fr', city: 'Paris' },
    experienceLevel: { id: rang, label: rang },
  } as unknown as SmartRecruitersPosting;
}

/** Une offre Recruitee minimale, portant le rang de séniorité natif de la source. */
function offreRecruitee(rang: string) {
  return {
    id: 4242,
    title: 'Client Advisor',
    city: 'Paris',
    country: 'fr',
    created_at: '2026-09-01T00:00:00Z',
    experience_code: rang,
  } as never;
}

describe('L4 — rang de séniorité vs durée', () => {
  describe('ACCEPTATION — aucune conversion arbitraire d\'un rang en années', () => {
    it('les rangs SmartRecruiters ne produisent AUCUNE année', () => {
      /*
       * Les valeurs réelles de l'échelle LinkedIn reprise par SmartRecruiters. Aucune ne dit un
       * nombre d'années : deux entreprises posent `mid_senior_level` à 3 ans et à 10 ans.
       * Les deux lecteurs de durée existants sont éprouvés : aucun ne doit les accepter.
       */
      for (const rang of ['entry_level', 'mid_senior_level', 'associate', 'not_applicable', 'executive', 'director']) {
        expect(lvmhExperienceYears(rang), `lvmh/${rang}`).toBeUndefined();
        expect(personioExperienceYears(rang), `personio/${rang}`).toBeUndefined();
      }
    });

    it('une offre Recruitee portant `experience_code` n\'écrit pas d\'années', () => {
      /*
       * LE TÉMOIN CORRIGÉ. La version précédente s'appelait « les rangs Recruitee » mais
       * n'appelait que `lvmhExperienceYears` et `personioExperienceYears` : elle ne traversait
       * JAMAIS l'adaptateur Recruitee, donc elle ne gardait rien de ce chemin. C'est exactement
       * le défaut que ce lot corrige ailleurs — un témoin qui n'atteint pas le code qu'il
       * prétend garder.
       */
      for (const rang of ['entry_level', 'mid_level', 'experienced', 'manager', 'student_school']) {
        const job = parseRecruiteeJob(offreRecruitee(rang), 'demo-maison');

        expect(job.experienceYears, `experienceYears pour ${rang}`).toBeUndefined();

        // PRÉMISSE : le rang a bien atteint l'adaptateur et survit dans le RAW. Sans elle, le
        // témoin passerait au vert même si `experience_code` n'était jamais transmis.
        expect(JSON.stringify(job.raw), `rang absent du raw pour ${rang}`).toContain(rang);
      }
    });

    it('une offre SmartRecruiters portant un rang n\'écrit pas d\'années', () => {
      /*
       * LE TÉMOIN DE BOUT EN BOUT, celui qui manquait. Il part d'une charge utile de la source et
       * traverse l'adaptateur : si quelqu'un branche `experienceLevel` sur `experienceYears`,
       * c'est ici que ça rougit.
       */
      const job = parseSmartRecruitersPosting(offreAvecRang('mid_senior_level'), 'demo-maison');
      expect(job.experienceYears).toBeUndefined();

      // PRÉMISSE — sans elle, ce témoin passerait au vert même si le rang n'atteignait jamais
      // l'adaptateur, et il ne prouverait alors rien du tout.
      expect(JSON.stringify(job.raw)).toContain('mid_senior_level');
    });

    it('« not_applicable » n\'est pas zéro', () => {
      // Zéro est une EXIGENCE (« débutant accepté ») ; l'absence est un SILENCE. Les confondre
      // ferait apparaître l'offre dans un filtre « 0 an d'expérience » qu'elle ne revendique pas.
      expect(lvmhExperienceYears('not_applicable')).toBeUndefined();
      expect(personioExperienceYears('not_applicable')).toBeUndefined();
      // Et la preuve que zéro EXISTE bien comme valeur lisible, donc qu'il est distinct :
      expect(lvmhExperienceYears('Beginner')).toBe(0);
    });
  });

  describe('ACCEPTATION — une durée explicite reste correctement lue', () => {
    it('les durées déclarées par LVMH produisent bien des années', () => {
      /*
       * Le témoin symétrique, indispensable : le garde ne doit pas se transformer en refus
       * global. Une source qui ÉNONCE une durée doit continuer d'être lue.
       */
      expect(lvmhExperienceYears('Beginner')).toBe(0);
      expect(lvmhExperienceYears('Minimum 3 years')).toBe(3);
    });

    it('un intervalle Personio est lu à sa borne basse', () => {
      // `2-5` → 2 : on n'exige jamais plus que ce que la source demande.
      expect(personioExperienceYears('2-5')).toBe(2);
    });

    it('une valeur vide ou non textuelle ne produit rien', () => {
      for (const v of ['', '   ', null, undefined, 42, {}]) {
        expect(lvmhExperienceYears(v as unknown), JSON.stringify(v)).toBeUndefined();
        expect(personioExperienceYears(v as unknown), JSON.stringify(v)).toBeUndefined();
      }
    });
  });

  describe('comportement ACTUEL — documenté, non verrouillé comme cible', () => {
    it('SmartRecruiters ne mappe pas du tout `experienceLevel`', () => {
      /*
       * État des lieux, pas invariant : le champ n'est pas dans le type de l'adaptateur et ne
       * survit que dans `raw`. Si la décision D-3 (brancher `Job.seniority`) est prise, ce témoin
       * devra changer — celui d'ACCEPTATION ci-dessus, non.
       */
      const job = parseSmartRecruitersPosting(offreAvecRang('entry_level'), 'demo-maison');
      expect(job.experienceYears).toBeUndefined();

      // Le rang reste disponible dans le RAW : l'information n'est pas perdue, elle n'est pas
      // canonisée. C'est ce qui rend la décision D-3 possible sans nouvelle collecte.
      expect(JSON.stringify(job.raw)).toContain('entry_level');
    });
  });
});
