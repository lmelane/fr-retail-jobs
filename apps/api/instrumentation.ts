/** The existing API runtime maintains its local PostgreSQL projection. No source
 * collection or external service call; a durable DB queue survives restarts. */
export async function register() {
  // Positive runtime branch lets Next exclude Node-only dependencies from its Edge bundle.
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    if (process.env.NEXT_PHASE === 'phase-production-build' || !process.env.DATABASE_URL) return;
    const { initializeSearchIndex, drainSearchIndex, advanceSearchRequeue } = await import('./lib/search-index');
    const { surveillerFileRecherche } = await import('./lib/search-alert');
    const { purgerRequetesSiDue } = await import('./lib/requetes-tapees');
    const state = globalThis as typeof globalThis & { catwalksSearchLoop?: boolean };
    if (state.catwalksSearchLoop) return;
    state.catwalksSearchLoop = true;
    let initialized = false;
    async function tick() {
      let worked = false;
      try {
        if (!initialized) { await initializeSearchIndex(); initialized = true; }
        worked = (await drainSearchIndex()) > 0;
        // File vide : la tranche suivante d'une remise en file demandée par un changement de taxonomie (D-475, §3.6).
        if (!worked) worked = (await advanceSearchRequeue()) > 0;
        // Une fois par minute au plus : l'âge de la file, et l'alerte par e-mail au-delà de 60 s (D-475, plan §3.2).
        await surveillerFileRecherche();
        // D-501 : une fois par heure au plus, la purge des requêtes tapées (sous le seuil après 30 jours, toutes après un an).
        await purgerRequetesSiDue();
      } catch (error) {
        console.error(JSON.stringify({ event: 'search.projection_failed', error: error instanceof Error ? error.name : 'unknown' }));
      }
      setTimeout(tick, worked ? 10 : 2000).unref();
    }
    await tick();
  }
}
