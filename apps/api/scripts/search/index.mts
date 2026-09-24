import { prisma } from '@catwalks/db';
import { initializeSearchIndex, drainSearchIndex, searchIndexStatus, retireSearchGeneration, SEARCH_VERSION } from '../../lib/search-index.ts';
try {
  const [command,version,confirmation] = process.argv.slice(2);
  if (command === 'status') console.log(await searchIndexStatus());
  else if (command === 'rebuild') {
    await initializeSearchIndex();
    // Resume the existing durable backlog, including after interruption.
    let indexed=0; while (await drainSearchIndex()) { indexed++; if(indexed%20===0) console.log({batches:indexed,version:SEARCH_VERSION}); }
    // Initial bulk backfills need current planner statistics before public traffic.
    await prisma.$executeRaw`ANALYZE "SearchDocument"`;
    console.log(await searchIndexStatus());
  } else if (command === 'retire' && version && confirmation === '--previous-runtime-stopped') {
    console.log({retired:version,removed:await retireSearchGeneration(version)});
  } else throw Error('Usage: index.mts status | rebuild | retire VERSION --previous-runtime-stopped');
} finally { await prisma.$disconnect(); }
