import { prisma } from '@catwalks/db';
import { initializeSearchIndex, drainSearchIndex, advanceSearchRequeue, searchIndexStatus, retireSearchGeneration, SEARCH_VERSION } from '../../lib/search-index.ts';
try {
  const [command,version,confirmation] = process.argv.slice(2);
  if (command === 'status') console.log(await searchIndexStatus());
  else if (command === 'rebuild') {
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
