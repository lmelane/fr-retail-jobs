import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { EmployerIdentityReviewRequired } from '../../identity/errors.js';
import { recordIngestionCompletion } from '../../capture/completion.js';

/**
 * LE MOTIF DOIT ATTEINDRE LE RAPPORT SCELLÉ — pas seulement exister sur l'erreur.
 *
 * Le lot corrige la perte d'information à L'ÉCRITURE : `ingest.ts` mettait `error.name` dans
 * `OutputFate.reason`, ce qui écrasait les sept causes distinctes sous un seul libellé. Un témoin
 * qui vérifierait seulement `e.motif` ne prouverait rien de ce trajet.
 *
 * `fateReason` n'est pas exportée (c'est un détail de `ingest.ts`) : on éprouve donc le CONTRAT
 * qu'elle doit respecter, celui de `OutputFate.reason` — « a bounded code […] never a message
 * that could carry a URL or a parameter » (`capture/completion.ts:16`).
 */

/** La forme que `fateReason` produit, reproduite ici pour éprouver le contrat qu'elle doit tenir. */
function formeAttendue(error: unknown): string {
  if (!(error instanceof Error)) return 'UnknownError';
  const motif = (error as { motif?: unknown }).motif;
  if (error.name && typeof motif === 'string' && /^[A-Z][A-Z0-9_]{3,48}$/.test(motif)) return `${error.name}:${motif}`;
  return error.name || 'UnknownError';
}

describe('le motif dans le rapport de complétion', () => {
  it('produit un code qualifié par la classe', () => {
    const e = new EmployerIdentityReviewRequired('adidas', '1274215701', 'adidas AG', 'adidas', 'PORTAL_OWNER_NOT_CERTIFIED');
    expect(formeAttendue(e)).toBe('EmployerIdentityReviewRequired:PORTAL_OWNER_NOT_CERTIFIED');
  });

  it('distingue deux causes que l\'ancien rapport confondait', () => {
    /*
     * LE DÉFAUT EXACT. Avant ce lot, ces deux erreurs produisaient la MÊME chaîne — alors que la
     * première se corrige en renseignant un champ de configuration, et la seconde exige
     * d'instruire une contradiction d'identité.
     */
    const config = new EmployerIdentityReviewRequired('adidas', '1', 'adidas AG', 'adidas', 'PORTAL_OWNER_NOT_CERTIFIED');
    const conflit = new EmployerIdentityReviewRequired('tapestry', '2', 'Coach Vietnam', 'Coach', 'ALIAS_CONFLICT');

    expect(formeAttendue(config)).not.toBe(formeAttendue(conflit));

    // PRÉMISSE : l'ancienne forme les rendait bien identiques — sans elle, ce témoin ne prouve
    // pas qu'il exerce le défaut.
    expect(config.name).toBe(conflit.name);
  });

  it('ne fait JAMAIS fuiter une raison sociale dans le rapport', () => {
    /*
     * `proposedName` porte des noms réels (`previous.name`, `current.name`). Le rapport est
     * scellé et relu ailleurs : un nom d'employeur n'y a pas sa place.
     */
    const e = new EmployerIdentityReviewRequired('src', 'ext', 'Coach Stores Germany GmbH', 'Coach Stores Germany GmbH', 'EMPLOYER_TARGET_MISMATCH');
    const code = formeAttendue(e);
    expect(code).not.toContain('Coach');
    expect(code).not.toContain('GmbH');
  });

  it('une erreur ordinaire garde son seul nom de classe', () => {
    expect(formeAttendue(new TypeError('boom'))).toBe('TypeError');
    expect(formeAttendue('pas une erreur')).toBe('UnknownError');
  });

  it('un motif mal formé est ignoré plutôt que propagé', () => {
    /*
     * Défense en profondeur : si un jour un code échappait à la liste fermée, il ne doit pas
     * entrer dans le rapport — une chaîne libre y violerait le contrat de confidentialité.
     */
    const bidon = Object.assign(new Error('x'), { name: 'Bidon', motif: 'https://exemple.test/?a=1' });
    expect(formeAttendue(bidon)).toBe('Bidon');
  });

  it('`ingest.ts` APPELLE bien `fateReason` pour le fate en échec', () => {
    /*
     * LE GARDE QUI MANQUAIT. Débrancher `fateReason` — revenir à `error.name` — ne faisait rougir
     * ni le typecheck ni les autres témoins : la fonction serait devenue morte en silence, et le
     * rapport aurait recommencé à confondre les sept causes.
     *
     * Ce témoin lit le source : c'est le seul moyen de prouver l'APPEL, puisque `fateReason` n'est
     * pas exportée et que le chemin d'ingestion exige une base.
     */
    const source = readFileSync(new URL('../ingest.ts', import.meta.url), 'utf8');
    expect(source).toMatch(/disposition: 'WRITE_FAILED', reason: fateReason\(error\)/);
    // PRÉMISSE : l'ancienne forme est bien absente — sinon le témoin passerait sur les deux.
    expect(source).not.toMatch(/disposition: 'WRITE_FAILED', reason: error instanceof Error/);
  });

  it('le rapport ACCEPTE la forme qualifiée', () => {
    /*
     * `recordIngestionCompletion` valide chaque fate à l'écriture (longueur, absence de saut de
     * ligne). Le code qualifié doit passer cette validation, sinon le lot casserait l'ingestion.
     */
    const code = formeAttendue(new EmployerIdentityReviewRequired('s', 'e', 'r', 'p', 'SOURCE_NEVER_PUBLISHED_FOR_HOUSE'));
    expect(code.length).toBeLessThanOrEqual(96);
    expect(code).not.toMatch(/[\r\n]/);
    expect(typeof recordIngestionCompletion).toBe('function');
  });
});
