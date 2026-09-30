import { prisma } from '@catwalks/db';

/**
 * LE SIGNAL « MÉTIER MANQUANT » D'UN RECRUTEUR CATWALKS (D-475 §31 b et §32 ; plan `classification-metiers.md` §3.7).
 *
 * Un recruteur dont le métier manque choisit le plus proche et publie tout de suite ; il signale « métier manquant ».
 * Le backend enregistre le signal chez lui, puis le remet ici, par SA clé (`CATALOGUE_API_KEY_BACKEND`), jamais par la
 * liste publique des offres. Le signal suffit à la passe de curation suivante, sans preuve de volume (§32). Après la
 * passe, sa résolution (le nouveau métier, ou un rejet) est inscrite sur la ligne et le backend la relit pour réécrire
 * le métier de l'offre, qui revient ensuite ici par la liste publique.
 *
 * Ce module ne fait confiance à rien : chaque champ est relu, borné, et le signal est idempotent sur son identifiant
 * au backend (un renvoi après une panne réseau ne crée pas de doublon). Aucune donnée de personne : l'offre, son
 * intitulé, le métier choisi et le commentaire du recruteur.
 */
export const SOURCE_BACKEND = 'backend';
export const CORPS_MAX_OCTETS = 8_192;
export const IDS_PAR_LECTURE_MAX = 100;

export type SignalementRecu = {
  id: string;
  offreId: string;
  titre: string;
  metierChoisi: string | null;
  commentaire: string | null;
  signaleLe: Date;
};

export class SignalementInvalideError extends Error {
  constructor(readonly chemin: string, detail: string) {
    super(`Signalement invalide à ${chemin} : ${detail}`);
    this.name = 'SignalementInvalideError';
  }
}

const IDENTIFIANT = /^[A-Za-z0-9_-]{1,64}$/;
/** Une clé de métier de la taxonomie : minuscules, chiffres et tirets (`sales-advisor`). */
export const CLE_METIER = /^[a-z0-9][a-z0-9-]{0,99}$/;

function texteBorne(v: unknown, chemin: string, max: number, facultatif = false): string | null {
  if (v === null || v === undefined) {
    if (facultatif) return null;
    throw new SignalementInvalideError(chemin, 'texte attendu');
  }
  if (typeof v !== 'string') throw new SignalementInvalideError(chemin, 'texte attendu');
  const t = v.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '').trim();
  if (!t) {
    if (facultatif) return null;
    throw new SignalementInvalideError(chemin, 'texte vide');
  }
  if (t.length > max) throw new SignalementInvalideError(chemin, `au plus ${max} caractères`);
  return t;
}

/** Le corps reçu, relu champ par champ. */
export function lireSignalement(v: unknown): SignalementRecu {
  if (!v || typeof v !== 'object' || Array.isArray(v)) throw new SignalementInvalideError('signalement', 'objet attendu');
  const o = v as Record<string, unknown>;
  const id = typeof o.id === 'string' && IDENTIFIANT.test(o.id) ? o.id : null;
  if (!id) throw new SignalementInvalideError('id', 'identifiant attendu');
  const offreId = typeof o.offreId === 'string' && IDENTIFIANT.test(o.offreId) ? o.offreId : null;
  if (!offreId) throw new SignalementInvalideError('offreId', 'identifiant attendu');
  const titre = texteBorne(o.titre, 'titre', 500)!;
  const metierChoisi = o.metierChoisi === null || o.metierChoisi === undefined ? null : typeof o.metierChoisi === 'string' && CLE_METIER.test(o.metierChoisi) ? o.metierChoisi : undefined;
  if (metierChoisi === undefined) throw new SignalementInvalideError('metierChoisi', 'clé de métier attendue');
  const commentaire = texteBorne(o.commentaire, 'commentaire', 1_000, true);
  const brut = typeof o.signaleLe === 'string' ? o.signaleLe : '';
  const signaleLe = new Date(brut);
  if (!brut || Number.isNaN(signaleLe.getTime())) throw new SignalementInvalideError('signaleLe', 'date ISO attendue');
  return { id, offreId, titre, metierChoisi, commentaire, signaleLe };
}

/**
 * Enregistre le signal une seule fois. Rend `cree: false` quand il était déjà reçu : la première version fait foi, un
 * renvoi ne la réécrit pas (la passe a peut-être déjà commencé à la lire).
 */
export async function enregistrerSignalement(s: SignalementRecu): Promise<{ cree: boolean }> {
  const lignes = await prisma.$executeRaw`INSERT INTO "OccupationMissingSignal"
    ("id","source","externalId","offerId","title","chosenOccupation","comment","signaledAt")
    VALUES (${`sig_${SOURCE_BACKEND}_${s.id}`}, ${SOURCE_BACKEND}, ${s.id}, ${s.offreId}, ${s.titre}, ${s.metierChoisi}, ${s.commentaire}, ${s.signaleLe})
    ON CONFLICT ("source","externalId") DO NOTHING`;
  return { cree: lignes === 1 };
}

export type StatutSignalement = 'ouvert' | 'resolu' | 'rejete';
export type ResolutionSignalement = { id: string; statut: StatutSignalement; metier: string | null; releaseId: string | null; resoluLe: string | null };

const STATUTS: Record<string, StatutSignalement> = { OPEN: 'ouvert', RESOLVED: 'resolu', REJECTED: 'rejete' };

/** Les ids relus depuis la requête (`?ids=a,b`), bornés : au plus 100, chacun un identifiant. */
export function lireIds(brut: string | null): string[] {
  const ids = [...new Set((brut ?? '').split(',').map((s) => s.trim()).filter(Boolean))];
  if (ids.length > IDS_PAR_LECTURE_MAX) throw new SignalementInvalideError('ids', `au plus ${IDS_PAR_LECTURE_MAX}`);
  for (const id of ids) if (!IDENTIFIANT.test(id)) throw new SignalementInvalideError('ids', 'identifiant attendu');
  return ids;
}

/** L'état de signaux déjà remis, par leur identifiant au backend. Un identifiant inconnu est absent de la réponse. */
export async function resolutions(ids: readonly string[]): Promise<ResolutionSignalement[]> {
  if (!ids.length) return [];
  const lignes = await prisma.occupationMissingSignal.findMany({
    where: { source: SOURCE_BACKEND, externalId: { in: [...ids] } },
    select: { externalId: true, status: true, resolvedOccupation: true, resolvedReleaseId: true, resolvedAt: true },
    orderBy: { externalId: 'asc' },
  });
  return lignes.map((l) => ({
    id: l.externalId,
    statut: STATUTS[l.status] ?? 'ouvert',
    metier: l.status === 'RESOLVED' ? l.resolvedOccupation : null,
    releaseId: l.status === 'RESOLVED' ? l.resolvedReleaseId : null,
    resoluLe: l.resolvedAt ? l.resolvedAt.toISOString() : null,
  }));
}
