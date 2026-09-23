import { describe, expect, it } from 'vitest';
import { EmployerIdentityReviewRequired, MOTIFS_IDENTITE, type MotifIdentite } from '../errors.js';

/**
 * LA TRAÇABILITÉ DES MOTIFS D'IDENTITÉ EMPLOYEUR.
 *
 * ── LE DÉFAUT CORRIGÉ ──────────────────────────────────────────────────────────────────────────
 *
 * `resolve.ts` lève `EmployerIdentityReviewRequired` à SEPT endroits, pour des causes qui
 * appellent des suites opposées : une configuration absente se corrige en renseignant un champ,
 * une contradiction d'identité exige d'instruire le cas. Or le rapport de complétion ne
 * conservait que le NOM DE LA CLASSE (`error.name`) :
 *
 *     {"ordinal":0,"externalId":"...","disposition":"WRITE_FAILED",
 *      "reason":"EmployerIdentityReviewRequired"}
 *
 * Les sept causes y étaient indiscernables. Mesuré le 2026-09-21 : 9 386 occurrences sous ce seul
 * libellé, et il a fallu reconstituer les causes depuis l'état du référentiel pour découvrir que
 * 27 sources sur 44 étaient bloquées par un simple `portalScope` non renseigné.
 *
 * ── POURQUOI UN CODE, ET PAS LE MESSAGE ────────────────────────────────────────────────────────
 *
 * Le contrat de `OutputFate.reason` (`capture/completion.ts:16`) est explicite : « a bounded code
 * […] never a message that could carry a URL or a parameter ». Le motif est donc un CODE d'une
 * liste fermée, jamais le nom d'un employeur ni une chaîne libre — ce qui interdit aussi de fuiter
 * une raison sociale dans un rapport scellé.
 */
describe('motifs d\'identité employeur', () => {
  describe('le code est borné, jamais une donnée', () => {
    it('expose un code de la liste fermée', () => {
      const e = new EmployerIdentityReviewRequired('src', 'ext', 'Adidas AG', 'Adidas', 'PORTAL_OWNER_NOT_CERTIFIED');
      expect(e.motif).toBe('PORTAL_OWNER_NOT_CERTIFIED');
      expect(MOTIFS_IDENTITE).toContain(e.motif);
    });

    it('tous les motifs respectent le contrat de `OutputFate.reason`', () => {
      /*
       * Le contrat impose un code borné, sans retour à la ligne, de longueur raisonnable.
       * Un motif qui le violerait ferait refuser le rapport à la lecture.
       */
      for (const m of MOTIFS_IDENTITE) {
        expect(m, m).toMatch(/^[A-Z][A-Z0-9_]{3,48}$/);
        expect(m).not.toMatch(/[\r\n]/);
      }
    });

    it('aucun motif ne peut porter un nom d\'employeur', () => {
      /*
       * PRÉMISSE du contrat de confidentialité : la liste est FERMÉE. Si le motif était libre,
       * `previous.name` ou `current.name` — des raisons sociales réelles — finiraient dans un
       * rapport scellé. C'est exactement ce que le champ `proposedName` fait aujourd'hui, et
       * c'est pourquoi il reste distinct du motif.
       */
      const e = new EmployerIdentityReviewRequired('src', 'ext', 'Coach Vietnam Ltd', 'Coach', 'ALIAS_CONFLICT');
      expect(e.motif).not.toContain('Coach');
      // Le nom proposé reste disponible pour le journal applicatif, hors du rapport scellé.
      expect(e.proposedName).toBe('Coach');
    });
  });

  describe('les motifs actuels et historiques restent lisibles', () => {
    it('conserve les codes des reçus historiques', () => {
      /*
       * Les SEPT causes réelles de `resolve.ts`, dans l'ordre du fichier. Les confondre revenait
       * à traiter une configuration absente comme un arbitrage d'identité.
       */
      const attendus: MotifIdentite[] = [
        'PORTAL_OWNER_NOT_CERTIFIED',      // :43 — scope non renseigné ou non SINGLE_BRAND
        'PORTAL_OWNER_REPLACES_EMPLOYER',  // :51 — le portail contredit l'employeur déjà attribué
        'ALIAS_CONFLICT',                  // :63 — deux alias mènent à deux racines
        'ALIAS_SOURCE_OR_TENANT_CHANGED',  // :68 — l'alias ne vaut plus pour cette source
        'EMPLOYER_SPELLING_DIVERGED',      // :107 — nouvelle graphie, sans convergence
        'EMPLOYER_TARGET_MISMATCH',        // :111 — l'employeur courant n'est pas la cible
        'SOURCE_NEVER_PUBLISHED_FOR_HOUSE', // :139 — première publication sous un libellé tiers
      ];
      for (const m of attendus) expect(MOTIFS_IDENTITE, m).toContain(m);
      // La liste ne contient QUE ces motifs : un code non documenté serait un angle mort.
      expect([...MOTIFS_IDENTITE].sort()).toEqual([...attendus].sort());
    });

    it('le motif survit au passage par `error.name`', () => {
      /*
       * `ingest.ts:404` écrit `error.name` dans le rapport. Le motif doit être lisible SANS
       * changer ce contrat : c'est une propriété de l'erreur, que l'écrivain lira explicitement.
       */
      const e = new EmployerIdentityReviewRequired('src', 'ext', 'X', 'Y', 'ALIAS_CONFLICT');
      expect(e.name).toBe('EmployerIdentityReviewRequired');
      expect(e.motif).toBe('ALIAS_CONFLICT');
    });
  });
});
