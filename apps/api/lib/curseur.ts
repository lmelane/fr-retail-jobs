import { createHash } from 'node:crypto';

/**
 * LE CURSEUR DE PAGINATION (lot 7) — un jeton opaque qui porte la clé ordonnée
 * de la dernière ligne servie et l'empreinte des critères qui l'ont produite.
 *
 * Pourquoi un curseur et non un décalage (`OFFSET`) : une offre insérée en
 * tête entre deux pages décalait toute la suite (doublon à la frontière), une
 * offre retirée faisait sauter la suivante. Une clé ordonnée reprend APRÈS une
 * valeur, pas après une position : rien n'est doublé ni sauté par une
 * insertion ou un retrait concurrent. Une modification qui change la clé
 * d'une offre entre deux pages peut la faire apparaître deux fois ou pas du
 * tout dans une même lecture : limite documentée d'un keyset sans instantané.
 *
 * Le jeton n'est pas un secret et n'est pas signé : il ne donne accès à rien
 * de plus qu'une nouvelle recherche. Il est REFUSÉ s'il vient d'autres
 * critères (autre périmètre, autres filtres, autre texte) : reprendre une
 * clé au milieu d'un autre ordre servirait une page qui ne veut rien dire.
 */
export const CURSEUR_VERSION = 1;
/** Taille maximale d'un jeton accepté depuis une URL publique. */
export const CURSEUR_MAX = 600;

export type ClePrimitive = number | string | null;

export class CurseurInvalideError extends Error {
  readonly code = 'CURSEUR_INVALIDE' as const;
  constructor(readonly detail: string) {
    super(`Curseur invalide : ${detail}`);
    this.name = 'CurseurInvalideError';
  }
  corps(requestId: string) {
    return { error: this.code, requestId };
  }
}

/** L'empreinte des critères : 16 hexadécimaux d'un SHA-256 d'une forme canonique (clés triées). */
export function empreinteCriteres(criteres: unknown): string {
  const canonique = JSON.stringify(criteres, (_cle, valeur) =>
    valeur && typeof valeur === 'object' && !Array.isArray(valeur)
      ? Object.fromEntries(Object.entries(valeur as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)))
      : valeur);
  return createHash('sha256').update(canonique).digest('hex').slice(0, 16);
}

export function encoderCurseur(empreinte: string, cle: readonly ClePrimitive[]): string {
  return Buffer.from(JSON.stringify({ v: CURSEUR_VERSION, h: empreinte, k: cle }), 'utf8').toString('base64url');
}

/**
 * Relit un jeton : forme, version, empreinte et arité sont vérifiés ; les
 * valeurs de la clé restent typées par l'appelant.
 */
export function decoderCurseur(jeton: string, empreinte: string, arite: number): ClePrimitive[] {
  if (jeton.length > CURSEUR_MAX || !/^[A-Za-z0-9_-]+$/.test(jeton)) throw new CurseurInvalideError('forme');
  let lu: unknown;
  try {
    lu = JSON.parse(Buffer.from(jeton, 'base64url').toString('utf8'));
  } catch {
    throw new CurseurInvalideError('illisible');
  }
  if (!lu || typeof lu !== 'object' || Array.isArray(lu)) throw new CurseurInvalideError('forme');
  const { v, h, k } = lu as { v?: unknown; h?: unknown; k?: unknown };
  if (v !== CURSEUR_VERSION) throw new CurseurInvalideError('version');
  if (h !== empreinte) throw new CurseurInvalideError('autres critères');
  if (!Array.isArray(k) || k.length !== arite) throw new CurseurInvalideError('clé');
  for (const x of k) {
    if (x !== null && typeof x !== 'number' && typeof x !== 'string') throw new CurseurInvalideError('clé');
    if (typeof x === 'number' && !Number.isFinite(x)) throw new CurseurInvalideError('clé');
    if (typeof x === 'string' && x.length > 200) throw new CurseurInvalideError('clé');
  }
  return k as ClePrimitive[];
}
