import { randomUUID } from 'node:crypto';
import { NextResponse, type NextRequest } from 'next/server';
import { refuserSiCleInvalide } from '@/lib/cle-api';
import {
  EXPORT_TAXONOMIE_CONTRAT,
  LIMITE_APPRISES_MAX,
  LIMITE_CONCEPTS_MAX,
  CurseurInconnuError,
  TaxonomieInstableError,
  TaxonomieNonActiveeError,
  comptes,
  conceptsDe,
  pageApprise,
  pageConcepts,
  versionActive,
} from '@/lib/taxonomie-export';
import { SignalementInvalideError, lireIds, resolutions } from '@/lib/signalements-metier';

/**
 * L'export versionné de la taxonomie des métiers, tiré par le BACKEND seul (`CATALOGUE_API_KEY_BACKEND`), plan §3.7.
 *
 *   ?partie=entete                      la version active (identifiant, empreinte), la table apprise active et les comptes
 *   ?partie=concepts&apres=&limite=     une page de concepts (domaines, familles, métiers), par curseur
 *   ?partie=apprise&apres=&limite=      une page de la table apprise active, par curseur
 *   ?partie=signalements&ids=a,b        l'état des signaux « métier manquant » déjà remis (au plus 100)
 *
 * Chaque page des trois premières parties porte la version qu'elle sert : le backend compare et recommence si elle
 * a changé pendant son chargement. Rien n'est mis en cache : la version active peut basculer à tout moment.
 */
export const dynamic = 'force-dynamic';

const ENTIER = /^\d{1,5}$/;
function limite(brut: string | null, defaut: number, max: number): number | null {
  if (brut === null || brut === '') return defaut;
  if (!ENTIER.test(brut)) return null;
  const n = Number(brut);
  return n >= 1 && n <= max ? n : null;
}

export async function GET(request: NextRequest) {
  const requestId = randomUUID();
  const refus = refuserSiCleInvalide(request, requestId, ['backend']);
  if (refus) return refus;
  const entetes = { 'x-request-id': requestId, 'cache-control': 'no-store' };
  const sp = request.nextUrl.searchParams;
  const partie = sp.get('partie') ?? 'entete';
  // Borne large : une clé d'intitulé de la table apprise peut être longue ; tronquée, le curseur re-servirait des entrées.
  const apres = sp.get('apres')?.slice(0, 10_000) || null;
  const erreur = (statut: number, message: string, extra: Record<string, string> = {}) =>
    NextResponse.json({ error: message, requestId }, { status: statut, headers: { ...entetes, ...extra } });

  try {
    if (partie === 'signalements') {
      const ids = lireIds(sp.get('ids'));
      return NextResponse.json({ contrat: EXPORT_TAXONOMIE_CONTRAT, signalements: await resolutions(ids) }, { headers: entetes });
    }
    if (partie !== 'entete' && partie !== 'concepts' && partie !== 'apprise') return erreur(400, 'partie : entete, concepts, apprise ou signalements.');

    const { version, taxonomie, apprise } = await versionActive();
    const base = { contrat: EXPORT_TAXONOMIE_CONTRAT, taxonomie: version, apprise };
    if (partie === 'entete') {
      return NextResponse.json({ ...base, comptes: comptes(conceptsDe(taxonomie)) }, { headers: entetes });
    }
    if (partie === 'concepts') {
      const n = limite(sp.get('limite'), 100, LIMITE_CONCEPTS_MAX);
      if (n === null) return erreur(400, `limite : 1 à ${LIMITE_CONCEPTS_MAX}.`);
      return NextResponse.json({ ...base, ...pageConcepts(conceptsDe(taxonomie), apres, n) }, { headers: entetes });
    }
    const n = limite(sp.get('limite'), 1_000, LIMITE_APPRISES_MAX);
    if (n === null) return erreur(400, `limite : 1 à ${LIMITE_APPRISES_MAX}.`);
    // Sans table apprise active, la partie est vide et finie : c'est un état normal (aucune passe ne l'a remplie).
    const page = apprise ? await pageApprise(apprise.releaseId, apres, n) : { entrees: [], suivant: null };
    return NextResponse.json({ ...base, ...page }, { headers: entetes });
  } catch (error) {
    if (error instanceof SignalementInvalideError) return erreur(400, error.message);
    if (error instanceof CurseurInconnuError) return erreur(409, error.message);
    if (error instanceof TaxonomieNonActiveeError) return erreur(503, error.message, { 'retry-after': '300' });
    if (error instanceof TaxonomieInstableError) return erreur(503, error.message, { 'retry-after': '5' });
    console.error(JSON.stringify({ evenement: 'taxonomie.export', requestId, partie, error: error instanceof Error ? error.message : String(error) }));
    return erreur(503, 'La taxonomie est indisponible.', { 'retry-after': '60' });
  }
}
