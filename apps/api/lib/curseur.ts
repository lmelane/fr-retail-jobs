import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';

/**
 * LE CURSEUR DE PAGINATION (lot 7) — un jeton opaque qui porte la clé ordonnée
 * de la dernière ligne servie, lié aux critères qui l'ont produite.
 *
 * Pourquoi un curseur et non un décalage (`OFFSET`) : une offre insérée en
 * tête entre deux pages décalait toute la suite (doublon à la frontière), une
 * offre retirée faisait sauter la suivante. Une clé ordonnée reprend APRÈS une
 * valeur, pas après une position : rien n'est doublé ni sauté par une
 * insertion ou un retrait concurrent. Une modification qui change la clé
 * d'une offre entre deux pages peut la faire apparaître deux fois ou pas du
 * tout dans une même lecture : limite documentée d'un keyset sans instantané.
 *
 * Il est REFUSÉ s'il vient d'autres critères (autre périmètre, autres filtres,
 * autre texte, autres préférences) : reprendre une clé au milieu d'un autre
 * ordre servirait une page qui ne veut rien dire.
 *
 * VERSION 3 (lecture D-492 du 02/10/2026, curseur signé) : le jeton reste dans
 * l'adresse (`apres=`), donc dans l'historique, les journaux d'hébergement et
 * les liens partagés. La version 2 y écrivait en clair l'empreinte NON SALÉE
 * des critères, préférences de classement comprises (salaire compris) : qui la
 * lisait pouvait retrouver les préférences par force brute, et la clé (dont le
 * score de la dernière offre, calculé sur ces préférences) y était lisible et
 * modifiable. Désormais la clé est CHIFFRÉE et AUTHENTIFIÉE (AES-256-GCM) sous
 * un secret du serveur de l'API (`CATALOGUE_CURSEUR_SECRET`), l'empreinte des
 * critères servant de données associées : elle n'est jamais écrite dans le
 * jeton. Un jeton forgé, modifié, chiffré sous un autre secret ou relu sous
 * d'autres critères échoue à l'authentification et est refusé. Les jetons de
 * la version 2 sont refusés (`version`) : une liste en cours de lecture au
 * moment de la livraison repart de sa première page.
 */
export const CURSEUR_VERSION = 3;
/** Taille maximale d'un jeton accepté depuis une URL publique. */
export const CURSEUR_MAX = 600;
/** La variable du secret du serveur de l'API (au moins 32 caractères). */
export const CURSEUR_SECRET_VARIABLE = 'CATALOGUE_CURSEUR_SECRET';
const SECRET_MIN = 32;
const NONCE = 12;
const ETIQUETTE = 16;

export type ClePrimitive = number | string | null;

/**
 * Sans secret configuré (ou trop court), une clé tirée au hasard pour CE processus : jamais une clé constante ni une
 * empreinte en clair. Les curseurs restent valables tant que le processus vit (un redémarrage fait repartir une liste
 * de sa première page) ; l'absence est écrite une fois au journal.
 */
let cleDuProcessus: Buffer | undefined;
let absenceDite = false;
function cleDeChiffrement(): Buffer {
  const secret = process.env[CURSEUR_SECRET_VARIABLE]?.trim();
  if (secret && secret.length >= SECRET_MIN) return createHash('sha256').update(`catwalks-curseur/${CURSEUR_VERSION}\0${secret}`).digest();
  if (!absenceDite) {
    absenceDite = true;
    console.error(JSON.stringify({ event: 'curseur.secret_absent', variable: CURSEUR_SECRET_VARIABLE, etat: secret ? 'trop_court' : 'absent',
      message: 'curseurs chiffrés sous une clé propre à ce processus' }));
  }
  return (cleDuProcessus ??= randomBytes(32));
}

const donneesAssociees = (empreinte: string) => Buffer.from(`${CURSEUR_VERSION}:${empreinte}`, 'utf8');

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

/**
 * L'empreinte des critères : 16 hexadécimaux d'un SHA-256 d'une forme canonique (clés triées). Elle n'est jamais écrite
 * dans un jeton : elle lie le jeton à ses critères (données associées du chiffrement).
 */
export function empreinteCriteres(criteres: unknown): string {
  const canonique = JSON.stringify(criteres, (_cle, valeur) =>
    valeur && typeof valeur === 'object' && !Array.isArray(valeur)
      ? Object.fromEntries(Object.entries(valeur as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)))
      : valeur);
  return createHash('sha256').update(canonique).digest('hex').slice(0, 16);
}

/** Le jeton : un octet de version, le nonce, la clé chiffrée, l'étiquette d'authentification ; en base64url. */
export function encoderCurseur(empreinte: string, cle: readonly ClePrimitive[]): string {
  const nonce = randomBytes(NONCE);
  const chiffre = createCipheriv('aes-256-gcm', cleDeChiffrement(), nonce, { authTagLength: ETIQUETTE });
  chiffre.setAAD(donneesAssociees(empreinte));
  const corps = Buffer.concat([chiffre.update(JSON.stringify(cle), 'utf8'), chiffre.final()]);
  return Buffer.concat([Buffer.from([CURSEUR_VERSION]), nonce, corps, chiffre.getAuthTag()]).toString('base64url');
}

/**
 * Relit un jeton : forme, version, authenticité sous CES critères, puis arité et types ; les valeurs de la clé restent
 * typées par l'appelant.
 */
export function decoderCurseur(jeton: string, empreinte: string, arite: number): ClePrimitive[] {
  if (jeton.length > CURSEUR_MAX || !/^[A-Za-z0-9_-]+$/.test(jeton)) throw new CurseurInvalideError('forme');
  const octets = Buffer.from(jeton, 'base64url');
  if (octets.length === 0) throw new CurseurInvalideError('forme');
  if (octets[0] !== CURSEUR_VERSION) throw new CurseurInvalideError('version');
  if (octets.length < 1 + NONCE + 2 + ETIQUETTE) throw new CurseurInvalideError('forme');
  let clair: string;
  try {
    const dechiffre = createDecipheriv('aes-256-gcm', cleDeChiffrement(), octets.subarray(1, 1 + NONCE), { authTagLength: ETIQUETTE });
    dechiffre.setAAD(donneesAssociees(empreinte));
    dechiffre.setAuthTag(octets.subarray(octets.length - ETIQUETTE));
    clair = Buffer.concat([dechiffre.update(octets.subarray(1 + NONCE, octets.length - ETIQUETTE)), dechiffre.final()]).toString('utf8');
  } catch {
    // Forgé, modifié, chiffré sous un autre secret, ou servi sous d'autres critères : indiscernables, tous refusés.
    throw new CurseurInvalideError('autres critères');
  }
  let k: unknown;
  try {
    k = JSON.parse(clair);
  } catch {
    throw new CurseurInvalideError('illisible');
  }
  if (!Array.isArray(k) || k.length !== arite) throw new CurseurInvalideError('clé');
  for (const x of k) {
    if (x !== null && typeof x !== 'number' && typeof x !== 'string') throw new CurseurInvalideError('clé');
    if (typeof x === 'number' && !Number.isFinite(x)) throw new CurseurInvalideError('clé');
    if (typeof x === 'string' && x.length > 200) throw new CurseurInvalideError('clé');
  }
  return k as ClePrimitive[];
}
