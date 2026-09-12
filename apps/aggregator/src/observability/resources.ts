/**
 * LES RESSOURCES DU RUN, mesurées DANS le processus qui tourne.
 *
 * Règle qui impose ce module (leçon D32) : une mesure prise à côté n'est pas la mesure du run. Lire la mémoire
 * depuis un poste de développement, ou les connexions depuis un conteneur `railway ssh` réveillé à la demande,
 * décrit cet environnement-là — pas celui du cron. Le seul endroit qui puisse dire la mémoire du service est le
 * service lui-même, et le seul moment est pendant qu'il travaille.
 *
 * Ce module échantillonne donc **depuis l'intérieur** : `process.memoryUsage()` et `process.cpuUsage()` pour le
 * conteneur, et une interrogation de `pg_stat_activity` pour le pool Postgres — la base voit l'état réel des
 * connexions, y compris celles qu'un pool local croit fermées.
 *
 * Ce qu'il ne fait pas : inventer une valeur qu'il ne peut pas lire. Une grandeur indisponible sort `null`
 * avec son motif, jamais une estimation « plausible » — un chiffre faux est plus coûteux qu'une case vide,
 * parce qu'on le croit.
 */
import type { PrismaClient } from '@prisma/client';

export type ResourceSample = {
  at: string;
  /** Mémoire du PROCESSUS, en octets — ce que le conteneur consomme réellement. */
  rssBytes: number;
  heapUsedBytes: number;
  heapTotalBytes: number;
  externalBytes: number;
  /** Microsecondes CPU cumulées depuis le démarrage du processus. */
  cpuUserUs: number;
  cpuSystemUs: number;
  /** L'état des connexions vu PAR LA BASE, jamais par le pool local. */
  db: {
    total: number | null;
    active: number | null;
    idle: number | null;
    idleInTransaction: number | null;
    waiting: number | null;
    longestQuerySeconds: number | null;
    /** Motif si la lecture a échoué : on dit pourquoi, on ne rend pas 0. */
    unavailable?: string;
  };
};

export type ResourceReport = {
  samples: number;
  before: ResourceSample | null;
  peak: { rssBytes: number; dbTotal: number | null; dbWaiting: number | null; longestQuerySeconds: number | null };
  after: ResourceSample | null;
  /** Limite mémoire du conteneur, lue dans cgroup v2 puis v1 ; `null` si le noyau ne l'expose pas. */
  memoryLimitBytes: number | null;
  /**
   * Le processus a-t-il redémarré pendant la fenêtre ?
   *
   * On ne peut pas l'observer depuis l'intérieur d'un processus qui aurait été tué : il ne serait plus là pour
   * le dire. Ce qu'on PEUT affirmer, c'est que le processus qui écrit ce rapport est le même que celui qui a
   * commencé — son uptime couvre la fenêtre. Le contraire (un run qui disparaît sans écrire sa fin) se lit sur
   * `PipelineRun.finishedAt IS NULL`, hors de ce module.
   */
  processUptimeSeconds: number;
  processCoveredWindow: boolean;
  /**
   * OOM : `null`, et c'est délibéré. Un OOM tue le processus — celui-ci ne peut pas le rapporter sur lui-même.
   * Rendre `false` laisserait croire à une absence CONSTATÉE d'OOM, alors qu'elle n'est que non observable ici.
   */
  oomObserved: null;
  notes: string[];
};

/** L'état des connexions, demandé à Postgres — la seule autorité sur ses propres connexions. */
export async function sampleDatabase(prisma: PrismaClient): Promise<ResourceSample['db']> {
  try {
    const rows: any[] = await prisma.$queryRawUnsafe(`
      SELECT count(*)::int AS total,
             count(*) FILTER (WHERE state = 'active')::int AS active,
             count(*) FILTER (WHERE state = 'idle')::int AS idle,
             count(*) FILTER (WHERE state = 'idle in transaction')::int AS idle_in_transaction,
             count(*) FILTER (WHERE wait_event_type IS NOT NULL)::int AS waiting,
             coalesce(max(extract(epoch FROM (now() - query_start))) FILTER (WHERE state = 'active'), 0)::float AS longest
      FROM pg_stat_activity WHERE datname = current_database()`);
    const r = rows[0] ?? {};
    return {
      total: r.total ?? null, active: r.active ?? null, idle: r.idle ?? null,
      idleInTransaction: r.idle_in_transaction ?? null, waiting: r.waiting ?? null,
      longestQuerySeconds: r.longest ?? null,
    };
  } catch (error) {
    return {
      total: null, active: null, idle: null, idleInTransaction: null, waiting: null, longestQuerySeconds: null,
      unavailable: `pg_stat_activity illisible : ${(error as Error).message.slice(0, 120)}`,
    };
  }
}

export async function sampleResources(prisma: PrismaClient): Promise<ResourceSample> {
  const m = process.memoryUsage();
  const c = process.cpuUsage();
  return {
    at: new Date().toISOString(),
    rssBytes: m.rss, heapUsedBytes: m.heapUsed, heapTotalBytes: m.heapTotal, externalBytes: m.external,
    cpuUserUs: c.user, cpuSystemUs: c.system,
    db: await sampleDatabase(prisma),
  };
}

/**
 * La limite mémoire du conteneur, lue dans le cgroup.
 *
 * Sans elle, un RSS est un nombre sans échelle : 400 Mo est confortable sous 2 Gio et critique sous 512 Mio.
 * cgroup v2 d'abord (`memory.max`), v1 en repli ; `max` signifie « pas de limite », et un noyau qui n'expose
 * rien rend `null` — jamais une valeur par défaut inventée.
 */
export async function readMemoryLimitBytes(): Promise<number | null> {
  const { readFile } = await import('node:fs/promises');
  for (const path of ['/sys/fs/cgroup/memory.max', '/sys/fs/cgroup/memory/memory.limit_in_bytes']) {
    try {
      const raw = (await readFile(path, 'utf8')).trim();
      if (raw === 'max') return null;
      const n = Number(raw);
      // cgroup v1 rend une valeur sentinelle énorme quand aucune limite n'est posée.
      if (Number.isFinite(n) && n > 0 && n < Number.MAX_SAFE_INTEGER / 2) return n;
    } catch { /* chemin absent : on essaie le suivant */ }
  }
  return null;
}

/** Un échantillonneur périodique, arrêté explicitement — il ne doit jamais retenir le processus. */
export function startResourceSampling(prisma: PrismaClient, intervalMs = 5_000) {
  const samples: ResourceSample[] = [];
  let stopped = false;

  const tick = async () => {
    if (stopped) return;
    try { samples.push(await sampleResources(prisma)); } catch { /* un échantillon manqué n'arrête pas un run */ }
  };

  void tick();
  const timer = setInterval(() => void tick(), intervalMs);
  // `unref` : l'échantillonneur ne doit pas empêcher le processus de se terminer.
  if (typeof timer.unref === 'function') timer.unref();

  return {
    async stop(): Promise<ResourceReport> {
      stopped = true;
      clearInterval(timer);
      await tick(); // un dernier échantillon APRÈS le travail
      const before = samples[0] ?? null;
      const after = samples[samples.length - 1] ?? null;
      const notes: string[] = [];
      if (samples.length < 2) notes.push('moins de deux échantillons : le pic n\'est pas distinguable de l\'état final');
      const dbUnavailable = samples.filter((s) => s.db.unavailable).length;
      if (dbUnavailable) notes.push(`${dbUnavailable} échantillon(s) sans lecture de pg_stat_activity`);
      return {
        samples: samples.length, before, after,
        peak: {
          rssBytes: Math.max(0, ...samples.map((s) => s.rssBytes)),
          dbTotal: samples.some((s) => s.db.total != null) ? Math.max(...samples.map((s) => s.db.total ?? 0)) : null,
          dbWaiting: samples.some((s) => s.db.waiting != null) ? Math.max(...samples.map((s) => s.db.waiting ?? 0)) : null,
          longestQuerySeconds: samples.some((s) => s.db.longestQuerySeconds != null)
            ? Math.max(...samples.map((s) => s.db.longestQuerySeconds ?? 0)) : null,
        },
        memoryLimitBytes: await readMemoryLimitBytes(),
        // Un run qui redémarre repart d'un processus neuf : un uptime plus court que la fenêtre le trahirait.
        processUptimeSeconds: Number(process.uptime().toFixed(1)),
        processCoveredWindow: before ? process.uptime() * 1000 >= Date.now() - new Date(before.at).getTime() : false,
        oomObserved: null,
        notes,
      };
    },
  };
}
