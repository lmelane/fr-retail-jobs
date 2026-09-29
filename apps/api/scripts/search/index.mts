import { prisma } from '@catwalks/db';
import { initializeSearchIndex, drainSearchIndex, advanceSearchRequeue, searchIndexStatus, retireSearchGeneration, SEARCH_VERSION } from '../../lib/search-index.ts';
try {
  const [command,version,confirmation] = process.argv.slice(2);
  if (command === 'status') console.log(await searchIndexStatus());
  else if (command === 'rebuild') {
    // search-5 ne se sert qu'avec la v3 active et le stock reclassé (plan D-475 §3.6, audit du 29/09/2026) : sous la v1,
    // des adjoints non classés sortiraient sous le responsable qu'ils secondent. Refus avant toute écriture.
    const [etat] = await prisma.$queryRaw<{ vocabulaire: string | null; manquants: number }[]>`
      SELECT r.manifest->>'searchVocabularyVersion' AS vocabulaire,
        (SELECT count(*)::int FROM "Job" j WHERE j."isActive" AND j."mergedIntoId" IS NULL AND j."occupationReleaseId" IS NOT NULL
          AND j."titleRolesReleaseId" IS DISTINCT FROM s."releaseId") AS manquants
      FROM "OccupationState" s JOIN "OccupationRelease" r ON r.id = s."releaseId" WHERE s.id = 'active'`;
    if (!etat?.vocabulaire || etat.manquants > 0)
      throw Error(`rebuild ${SEARCH_VERSION} refusé : ${!etat?.vocabulaire ? 'la taxonomie active ne porte pas le vocabulaire de recherche (v1)' : `${etat.manquants} offres actives sans métiers lus de la version active`} ; activer la v3 et reclasser d'abord (plan D-475 §3.6)`);
    await initializeSearchIndex();
    // Resume the existing durable backlog, including after interruption.
    // Construire une génération AVANT le déploiement de l'API qui la sert (plan D-475 §3.6) : la file initiale, puis
    // les tranches d'une remise en file demandée entre-temps par un changement de taxonomie.
    let indexed=0; while ((await drainSearchIndex()) || (await advanceSearchRequeue())) { indexed++; if(indexed%20===0) console.log({batches:indexed,version:SEARCH_VERSION}); }
    // Initial bulk backfills need current planner statistics before public traffic.
    await prisma.$executeRaw`ANALYZE "SearchDocument"`;
    console.log(await searchIndexStatus());
  } else if (command === 'retire' && version && confirmation === '--previous-runtime-stopped') {
    console.log({retired:version,removed:await retireSearchGeneration(version)});
  } else throw Error('Usage: index.mts status | rebuild | retire VERSION --previous-runtime-stopped');
} finally { await prisma.$disconnect(); }
