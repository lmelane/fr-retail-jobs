import { describe, expect, it } from 'vitest';
import { readEmployment, decomposeCompositeCode } from '../employment.js';

/**
 * L2 — LES ABRÉVIATIONS DE RYTHME `PT` / `FT` DANS LES CODES D'EMPLOI COMPOSITES.
 *
 * ── LE DÉFAUT, MESURÉ PAR EXÉCUTION LE 2026-09-20 ──────────────────────────────────────────────
 *
 * `decomposeCompositeCode('PT Temp/Seasonal')` rendait `{isSeasonal: true}` et
 * `readEmployment` y ajoutait `FIXED_TERM` : le RYTHME était perdu, alors que `PT` le nomme.
 * Observé sur Lever `commitment` : `PT Temp/Seasonal` (89 offres) et `FT Temp/Seasonal` (18).
 *
 * ── LA BORNE, QUI EST LE CŒUR DE CE LOT ────────────────────────────────────────────────────────
 *
 * `PT` et `FT` sont des abréviations DANGEREUSES hors contexte : « FT » vaut « feet » ou
 * « Financial Times », « PT » vaut « Portugal », « Physical Therapy » ou « point ». Elles ne sont
 * donc PAS ajoutées à `WORK_TIME_EXPLICIT`, qui s'applique à du texte libre (titres,
 * descriptions).
 *
 * Elles ne sont reconnues QUE dans `decomposeCompositeCode` — un champ de code dédié — et
 * SEULEMENT lorsqu'un AUTRE token d'emploi est présent dans la même valeur. Isolée, l'abréviation
 * ne prouve rien et reste ignorée.
 */
describe('L2 — abréviations PT / FT dans les codes composites', () => {
  describe('comportement CORRIGÉ attendu (tests d\'acceptation)', () => {
    it('« PT Temp/Seasonal » rend les TROIS dimensions', () => {
      // La valeur Lever réelle, 89 offres.
      const e = { ...decomposeCompositeCode('PT Temp/Seasonal'), ...readEmployment('PT Temp/Seasonal') };
      expect(e.workTime).toBe('PART_TIME');
      expect(e.employmentTerm).toBe('FIXED_TERM');
      expect(e.isSeasonal).toBe(true);
    });

    it('« FT Temp/Seasonal » — le cas symétrique, 18 offres', () => {
      const e = { ...decomposeCompositeCode('FT Temp/Seasonal'), ...readEmployment('FT Temp/Seasonal') };
      expect(e.workTime).toBe('FULL_TIME');
      expect(e.employmentTerm).toBe('FIXED_TERM');
      expect(e.isSeasonal).toBe(true);
    });

    it('accepte la casse et les séparateurs réellement observés', () => {
      for (const v of ['PT Temp/Seasonal', 'pt temp/seasonal', 'Pt Temp-Seasonal', 'PT_TEMP_SEASONAL', 'PT|Temp|Seasonal'])
        expect(decomposeCompositeCode(v).workTime, v).toBe('PART_TIME');
      for (const v of ['FT Permanent', 'ft_permanent', 'FT-Permanent'])
        expect(decomposeCompositeCode(v).workTime, v).toBe('FULL_TIME');
    });
  });

  describe('LA BORNE — l\'abréviation seule ne prouve rien', () => {
    it('« PT » et « FT » isolés restent IGNORÉS', () => {
      /*
       * SANS CETTE BORNE, la correction deviendrait une règle universelle et produirait des faux
       * positifs sur toute valeur contenant ces deux lettres.
       */
      expect(decomposeCompositeCode('PT').workTime).toBeUndefined();
      expect(decomposeCompositeCode('FT').workTime).toBeUndefined();
      expect(readEmployment('PT').workTime).toBeUndefined();
      expect(readEmployment('FT').workTime).toBeUndefined();
    });

    it('n\'attrape pas les homonymes courants', () => {
      // Aucun autre token d'emploi n'est présent : rien ne doit être déduit.
      for (const v of ['PT Barnum', 'FT 500', '5 FT tall', 'PT Portugal', 'Physical Therapy PT'])
        expect(decomposeCompositeCode(v).workTime, v).toBeUndefined();
    });

    it('reste inerte sur du texte libre, même avec un token d\'emploi', () => {
      /*
       * Le garde décisif : `WORK_TIME_EXPLICIT` — utilisé sur les titres et descriptions — ne
       * doit PAS connaître ces abréviations. Un titre « Seasonal Associate, 5 FT display » ne
       * devient pas un temps plein.
       */
      expect(readEmployment('Seasonal Associate, 5 FT display').workTime).toBeUndefined();
      expect(readEmployment('PT and full flexibility required').workTime).toBeUndefined();
    });

    it('un token inconnu ne devient pas une dimension', () => {
      // Le garde-fou historique du fichier, qui doit survivre au correctif.
      const e = decomposeCompositeCode('parttime_minijob');
      expect(e.workTime).toBe('PART_TIME');
      expect(e.employmentTerm).toBeUndefined();
    });
  });

  describe('NON-RÉGRESSION — les autres dimensions ne bougent pas', () => {
    it('les formes en toutes lettres sont inchangées', () => {
      expect(decomposeCompositeCode('Part Time').workTime).toBe('PART_TIME');
      expect(decomposeCompositeCode('Full Time').workTime).toBe('FULL_TIME');
      expect(readEmployment('Part Time').workTime).toBe('PART_TIME');
    });

    it('contrat, programme et saisonnalité restent identiques', () => {
      // Chaque valeur vérifie que le correctif du RYTHME n'a touché à rien d'autre.
      expect(decomposeCompositeCode('parttime_fixed_term')).toEqual({ workTime: 'PART_TIME', employmentTerm: 'FIXED_TERM' });
      expect(decomposeCompositeCode('fulltime_permanent')).toEqual({ workTime: 'FULL_TIME', employmentTerm: 'PERMANENT' });
      expect(decomposeCompositeCode('internship')).toEqual({ programType: 'INTERNSHIP' });
      expect(decomposeCompositeCode('seasonal')).toEqual({ isSeasonal: true });
      expect(decomposeCompositeCode('contract')).toEqual({});
      expect(readEmployment('CDD').employmentTerm).toBe('FIXED_TERM');
      expect(readEmployment('CDI').employmentTerm).toBe('PERMANENT');
    });

    it('« PT Temp/Seasonal » ne change NI le contrat NI la saisonnalité par rapport à avant', () => {
      /*
       * PRÉMISSE du lot : avant correctif, ces deux dimensions étaient déjà correctes. Le
       * correctif ne doit ajouter que le rythme — si l'une des deux bougeait, il aurait débordé.
       */
      const e = readEmployment('PT Temp/Seasonal');
      expect(e.employmentTerm).toBe('FIXED_TERM');
      expect(e.isSeasonal).toBe(true);
    });
  });
});
