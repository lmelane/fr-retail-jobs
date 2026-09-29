/**
 * REJOUER LE CONTRÔLE DE PÉRIMÈTRE D'ACCÈS — lecture seule.
 *
 *   python3 apps/aggregator/scripts/ops/db.py readonly npx tsx \
 *     apps/aggregator/scripts/ops/rejouer-perimetre-acces.mts [--heures=30] [--sources=a,b] [--rederiver]
 *
 * Le 29/09/2026, 14 sources sont tombées en `CaptureUnavailableError` au RUN, toutes sur la lecture d'une page de
 * détail : la requête sortait du périmètre de leur autorisation d'accès (`matchingAccessScope`), et le motif réel
 * (`ACCESS_SCOPE`) était écrasé par la capture. Une autorisation vit 30 jours ; son périmètre est dérivé des adresses
 * observées le jour où elle est accordée (`accessScopeDerivation.ts`). Une offre publiée après ce jour, dans un
 * répertoire que la dérivation n'a pas déclaré en préfixe, arrête sa source entière.
 *
 * Ce programme rejoue ce contrôle sans aucune requête vers les éditeurs : pour chaque source active dont la dernière
 * autorisation est ALLOWED, il lit les requêtes réellement observées par sa DERNIÈRE capture de qualification native
 * (celle du RUN, faite sans autorisation, qui parcourt les mêmes adresses que la collecte qui suit) et les confronte :
 *   · au périmètre de l'autorisation en vigueur (ce que la collecte a subi) ;
 *   · avec `--rederiver`, au périmètre que la dérivation ACTUELLE du code produirait depuis la capture qui a fondé
 *     cette autorisation (ce qu'un correctif de la dérivation aurait couvert, sans rien écrire).
 * Il rend, par source, les requêtes hors périmètre et un exemple de chemin.
 */
import { PrismaClient } from '@prisma/client';
import { observedRequests } from '../../src/connectors/sourceAccessQualification.js';
import { matchingAccessScope, parseAccessScopes, type AccessScope } from '../../src/connectors/accessScope.js';
import { deriveAccessScopes } from '../../src/connectors/accessScopeDerivation.js';
import { CRAWLER_IDENTITY } from '../../src/lib/crawlerIdentity.js';

const arg = (n: string) => process.argv.find((a) => a.startsWith(`--${n}=`))?.slice(n.length + 3);
const heures = Number(arg('heures') ?? 30);
const filtre = (arg('sources') ?? '').split(',').map((s) => s.trim()).filter(Boolean);
const rederiver = process.argv.includes('--rederiver');
const prisma = new PrismaClient({ log: [] });

type Requete = { method: string; url: URL; contentType: string };
const horsPerimetre = (scopes: readonly AccessScope[], requetes: Requete[]) => requetes.filter((r) => {
  try {
    matchingAccessScope(scopes, { url: r.url.toString(), method: r.method, format: 'HTTP_RESPONSE', userAgent: CRAWLER_IDENTITY } as never);
    return false;
  } catch { return true; }
});

try {
  const decisions = await prisma.$queryRawUnsafe<{ sourceKey: string; kind: string; document: { scopes: unknown; captureBatchId: string | null } }[]>(`
    SELECT DISTINCT ON (d."sourceKey") d."sourceKey", s.kind, d.document
      FROM "SourceAccessDecision" d JOIN "Source" s ON s.key = d."sourceKey" AND s.status = 'ACTIVE'
     WHERE d.verdict = 'ALLOWED' ${filtre.length ? 'AND d."sourceKey" = ANY($1::text[])' : ''}
     ORDER BY d."sourceKey", d.sequence DESC`, ...(filtre.length ? [filtre] : []));
  const lignes: Record<string, unknown>[] = [];
  let sansCapture = 0;
  for (const d of decisions) {
    // La dernière capture de qualification native : collecte d'offres, sans autorisation attachée, extraite.
    const [capture] = await prisma.$queryRawUnsafe<{ id: string; startedAt: Date }[]>(`
      SELECT b.id, b."startedAt" FROM "CaptureBatch" b JOIN "CaptureOutcome" o ON o."batchId" = b.id AND o.status = 'EXTRACTED'
       WHERE b."sourceKey" = $1 AND b.purpose = 'JOBS' AND b."accessDecisionId" IS NULL AND b."startedAt" > now() - make_interval(hours => $2::int)
       ORDER BY b."startedAt" DESC LIMIT 1`, d.sourceKey, heures);
    if (!capture) { sansCapture++; continue; }
    let requetes: Requete[];
    try { requetes = await observedRequests(prisma, capture.id); }
    catch (error) { lignes.push({ source: d.sourceKey, erreur: (error as Error).message.slice(0, 120) }); continue; }
    const actuel = horsPerimetre(parseAccessScopes(d.document.scopes), requetes);
    const ligne: Record<string, unknown> = { source: d.sourceKey, type: d.kind, requetes: requetes.length, horsPerimetre: actuel.length,
      exemple: actuel[0] ? `${actuel[0].method} ${actuel[0].url.origin}${actuel[0].url.pathname}` : null };
    if (rederiver && d.document.captureBatchId) {
      try {
        const fondatrices = await observedRequests(prisma, d.document.captureBatchId);
        const derive = deriveAccessScopes(d.kind, fondatrices);
        const restant = horsPerimetre(derive, requetes);
        ligne.horsPerimetreRederive = restant.length;
        ligne.exempleRederive = restant[0] ? `${restant[0].method} ${restant[0].url.origin}${restant[0].url.pathname}` : null;
        ligne.perimetresRederives = derive.length;
      } catch (error) { ligne.erreurRederive = (error as Error).message.slice(0, 120); }
    }
    lignes.push(ligne);
  }
  const touchees = lignes.filter((l) => Number(l.horsPerimetre) > 0);
  console.log(JSON.stringify({
    fenetreHeures: heures, autorisations: decisions.length, sansCaptureNative: sansCapture,
    sourcesHorsPerimetre: touchees.length,
    ...(rederiver ? { sourcesHorsPerimetreApresRederivation: lignes.filter((l) => Number(l.horsPerimetreRederive) > 0).length } : {}),
    erreurs: lignes.filter((l) => l.erreur || l.erreurRederive).length,
    detail: lignes.filter((l) => Number(l.horsPerimetre) > 0 || Number(l.horsPerimetreRederive) > 0 || l.erreur || l.erreurRederive)
      .sort((a, b) => String(a.source).localeCompare(String(b.source))),
  }, null, 1));
} finally {
  await prisma.$disconnect();
}
