import { describe, expect, it } from 'vitest';
import { parseLeverJob } from '../../ats/adapters/lever.js';
import { resolveCanonicalDimensions } from '../../trust/resolve.js';
import { decomposeCompositeCode } from '../employment.js';
import { EMPLOYMENT_RAW_KEYS } from '../employment-evidence.js';

/**
 * L2 — RÉCEPTION SUR LE PARCOURS RÉEL : adaptateur Lever → résolution canonique.
 *
 * ── POURQUOI CE FICHIER EXISTE, EN PLUS DES TESTS UNITAIRES ────────────────────────────────────
 *
 * Les témoins de `employment-abreviations-l2.test.ts` appellent `decomposeCompositeCode` et
 * `readEmployment` directement. Ils prouvent que la fonction corrigée se comporte bien — ils ne
 * prouvent PAS que l'application l'appelle avec les bonnes entrées.
 *
 * Or le correctif vit dans `decomposeCompositeCode`, et la garantie « pas de faux positif dans
 * les titres et descriptions » dépend entièrement de QUI appelle cette fonction et avec QUOI.
 * Elle doit donc se vérifier sur le chemin que l'application emprunte, pas sur un appel direct.
 *
 * ── CE QUE LA VÉRIFICATION DES APPELANTS A ÉTABLI ──────────────────────────────────────────────
 *
 * `decomposeCompositeCode` n'a qu'UN SEUL appelant applicatif : `readValue`
 * (`trust/resolve.ts:88`), lui-même appelé sur exactement trois familles d'entrées :
 *
 *   · `input.contract`     — le champ de contrat déclaré par l'adaptateur ;
 *   · `input.workingTime`  — le champ de rythme déclaré par l'adaptateur ;
 *   · les valeurs trouvées aux clés de `EMPLOYMENT_RAW_KEYS` dans le payload.
 *
 * Le TITRE et la DESCRIPTION ne passent jamais par `readValue` : ils sont traités par
 * `extractEmployment(input.title, input.description)`, qui n'appelle que `readEmployment`.
 * C'est ce cloisonnement — et non la seule présence d'un autre token — qui fait la borne.
 *
 * Le test `aucune clé de texte libre` ci-dessous garde ce cloisonnement : si quelqu'un ajoutait
 * `description` à `EMPLOYMENT_RAW_KEYS`, la borne tomberait et ce témoin rougirait.
 */

/** Une offre Lever minimale, portant la valeur de `categories.commitment` à éprouver. */
function offreLever(commitment: string, extra: Record<string, unknown> = {}) {
  return {
    id: `lever-${commitment.replace(/\W+/g, '-')}`,
    text: 'Client Advisor',
    createdAt: Date.parse('2026-09-01'),
    hostedUrl: 'https://jobs.lever.co/demo/abc',
    categories: { commitment, location: 'Paris, France' },
    ...extra,
  } as never;
}

/** Le parcours réel : adaptateur → résolution canonique, comme en production. */
function parcours(commitment: string, extra: Record<string, unknown> = {}) {
  const job = parseLeverJob(offreLever(commitment, extra), { company: 'demo-maison' });
  return {
    job,
    canonique: resolveCanonicalDimensions({
      sourceKey: 'lever:demo-maison',
      title: job.title,
      description: job.description,
      contract: job.contract,
      workingTime: job.workingTime,
      raw: job.raw,
    } as never),
  };
}

describe('L2 — parcours réel Lever → résolution canonique', () => {
  it('« PT Temp/Seasonal » produit PART_TIME jusqu\'au canonique', () => {
    const { job, canonique } = parcours('PT Temp/Seasonal');

    // PRÉMISSE : l'adaptateur a bien porté la valeur dans le champ de contrat dédié.
    // Sans elle, le témoin passerait au vert même si la valeur n'atteignait jamais le décodeur.
    expect(job.contract).toBe('PT Temp/Seasonal');

    expect(canonique.workTime).toBe('PART_TIME');
    expect(canonique.employmentTerm).toBe('FIXED_TERM');
    expect(canonique.isSeasonal).toBe(true);
  });

  it('« FT Temp/Seasonal » produit FULL_TIME jusqu\'au canonique', () => {
    const { job, canonique } = parcours('FT Temp/Seasonal');
    expect(job.contract).toBe('FT Temp/Seasonal');
    expect(canonique.workTime).toBe('FULL_TIME');
    expect(canonique.employmentTerm).toBe('FIXED_TERM');
    expect(canonique.isSeasonal).toBe(true);
  });

  it('les autres dimensions ne changent pas', () => {
    const { canonique } = parcours('PT Temp/Seasonal');
    // Le correctif ne touche QUE le rythme : rien ne doit apparaître ailleurs.
    expect(canonique.programType).toBeUndefined();
    expect(canonique.engagementType).toBeUndefined();

    // Et les valeurs en toutes lettres restent identiques sur le même parcours.
    expect(parcours('Full-time').canonique.workTime).toBe('FULL_TIME');
    expect(parcours('Part-time').canonique.workTime).toBe('PART_TIME');
    expect(parcours('Internship').canonique.programType).toBe('INTERNSHIP');
  });

  describe('LA BORNE, vérifiée sur le parcours réel', () => {
    it('« FT » dans le TITRE ne produit aucun rythme', () => {
      /*
       * LE CAS QUI COMPTE. Le titre passe par `extractEmployment`, jamais par
       * `decomposeCompositeCode` : l'abréviation n'y est pas reconnue, même accompagnée d'un
       * token d'emploi (« Seasonal » est ici dans le titre).
       */
      const job = parseLeverJob(
        { ...(offreLever('Full-time') as Record<string, unknown>), text: 'Seasonal Associate 5 FT display' } as never,
        { company: 'demo-maison' },
      );
      const canonique = resolveCanonicalDimensions({
        sourceKey: 'lever:demo-maison', title: job.title, description: job.description,
        contract: undefined, workingTime: undefined, raw: {},
      } as never);

      // PRÉMISSE : le titre contient bien « FT » et un token d'emploi.
      expect(job.title).toContain('FT');
      expect(job.title).toContain('Seasonal');

      expect(canonique.workTime).toBeUndefined();
    });

    it('« PT » dans la DESCRIPTION ne produit aucun rythme', () => {
      const canonique = resolveCanonicalDimensions({
        sourceKey: 'lever:demo-maison',
        title: 'Client Advisor',
        description: 'Permanent role. PT Barnum once said the show must go on. 5 FT displays.',
        contract: undefined, workingTime: undefined, raw: {},
      } as never);
      expect(canonique.workTime).toBeUndefined();
    });

    it('« PT » seul dans le champ de contrat ne produit aucun rythme', () => {
      // Aucun autre token d'emploi : l'abréviation ne prouve rien, même dans un champ dédié.
      const { canonique } = parcours('PT');
      expect(canonique.workTime).toBeUndefined();
    });

    it('aucune clé d\'emploi ne désigne un champ de texte libre', () => {
      /*
       * LE GARDE DU CLOISONNEMENT. La borne du correctif tient parce que `readValue` n'est
       * appliqué qu'à des champs de code. Ajouter `description` ou `title` à cette liste
       * rouvrirait la porte aux faux positifs — et ferait rougir ce témoin.
       */
      const texteLibre = ['description', 'title', 'name', 'body', 'content', 'jobDescription', 'summary', 'text'];
      for (const cle of EMPLOYMENT_RAW_KEYS)
        expect(texteLibre, `clé de texte libre dans EMPLOYMENT_RAW_KEYS : ${cle}`).not.toContain(cle);
    });

    it('un tag descriptif mêlant un mot reconnu et une abréviation ambiguë n\'invente rien', () => {
      /*
       * LE CAS LIMITE QUI A CASSÉ LA PREMIÈRE BORNE (2026-09-20).
       *
       * « Seasonal Associate 5 FT display » réunit tout ce qu'il faut pour tromper le décodeur :
       * le champ `tags3` EST dans `EMPLOYMENT_RAW_KEYS`, donc la valeur passe bien par
       * `readValue` ; `Seasonal` y est reconnu, ce qui « autorisait » l'abréviation ; et `FT`
       * y désigne des PIEDS, pas un temps plein.
       *
       * Résultat mesuré avant correctif : {"isSeasonal":true,"workTime":"FULL_TIME"} — un rythme
       * inventé à partir d'une mesure de longueur.
       *
       * La leçon : ni le nom du champ, ni la présence d'un autre token d'emploi ne prouvent que
       * la valeur EST un code de temps de travail. Seule la FORME de la valeur le prouve.
       */
      const canonique = resolveCanonicalDimensions({
        sourceKey: 'jibe:demo', title: 'Beauty Advisor', description: undefined,
        contract: undefined, workingTime: undefined,
        raw: { tags3: ['Seasonal Associate 5 FT display'] },
      } as never);

      // PRÉMISSE : la saisonnalité EST bien lue — c'est ce qui rendait l'abréviation éligible.
      expect(canonique.isSeasonal).toBe(true);

      expect(canonique.workTime, 'rythme inventé depuis « 5 FT display »').toBeUndefined();
    });

    it('la longueur en pieds ne devient jamais un rythme', () => {
      for (const v of ['5 FT display', '6 FT counter Seasonal', 'Seasonal 10 FT window'])
        expect(decomposeCompositeCode(v).workTime, v).toBeUndefined();
    });

    it('une valeur de tag non liée à l\'emploi ne produit aucun rythme', () => {
      /*
       * `tags3`/`tags4` (JIBE) portent des codes de magasin comme « ST1500 Woodinville WA » :
       * `EMPLOYMENT_RAW_KEYS` les inclut, donc ils PASSENT par `readValue`. Aucun token
       * d'emploi n'y figure, donc l'abréviation ne doit rien déclencher — c'est exactement le
       * rôle de la condition.
       */
      const canonique = resolveCanonicalDimensions({
        sourceKey: 'jibe:demo', title: 'Beauty Advisor', description: undefined,
        contract: undefined, workingTime: undefined,
        raw: { tags3: ['Beauty Advisor'], tags4: ['ST1500 Woodinville WA'] },
      } as never);
      expect(canonique.workTime).toBeUndefined();
    });
  });
});
