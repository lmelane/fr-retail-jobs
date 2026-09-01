import type { PrismaClient } from '@prisma/client';
import { geocodeMany, geoCacheKey } from '../geo/geocode.js';

/**
 * Resolves coordinates for jobs that have none, so the map can plot them.
 *
 * Works on DISTINCT CITIES, not on offers. Measured on real feeds: Richemont
 * posts 228 French jobs across 11 towns, Sephora 154 across 49, and together 382
 * jobs across 56 towns because four already overlapped. Per-offer lookups would
 * waste tens of thousands of calls on a few hundred places.
 *
 * Failed lookups are cached as `resolved: false` so a bad location string is not
 * retried on every run.
 */

export type GeocodeStats = {
  pending: number;
  lookedUp: number;
  jobsLocated: number;
  remaining: number;
};

export async function runGeocode(prisma: PrismaClient): Promise<GeocodeStats> {
  const pending = await prisma.job.findMany({
    where: { isFrance: true, isActive: true, latitude: null, location: { not: null } },
    select: { id: true, location: true },
  });

  if (!pending.length) {
    return { pending: 0, lookedUp: 0, jobsLocated: 0, remaining: 0 };
  }

  // Reuse anything already resolved — including known failures.
  const keys = [...new Set(pending.map((job) => geoCacheKey(job.location ?? '')).filter(Boolean))];
  const cached = await prisma.geoCache.findMany({ where: { queryKey: { in: keys } } });
  const cachedByKey = new Map(cached.map((row) => [row.queryKey, row]));

  const unknown = pending.filter((job) => !cachedByKey.has(geoCacheKey(job.location ?? '')));
  const { results, remaining } = await geocodeMany(unknown.map((job) => job.location ?? ''));

  for (const [queryKey, point] of results) {
    await prisma.geoCache.upsert({
      where: { queryKey },
      create: {
        queryKey,
        city: point?.city,
        postalCode: point?.postalCode,
        inseeCode: point?.inseeCode,
        latitude: point?.latitude,
        longitude: point?.longitude,
        resolved: Boolean(point),
      },
      update: {
        city: point?.city,
        postalCode: point?.postalCode,
        inseeCode: point?.inseeCode,
        latitude: point?.latitude,
        longitude: point?.longitude,
        resolved: Boolean(point),
      },
    });
    cachedByKey.set(queryKey, {
      queryKey,
      city: point?.city ?? null,
      postalCode: point?.postalCode ?? null,
      inseeCode: point?.inseeCode ?? null,
      latitude: point?.latitude ?? null,
      longitude: point?.longitude ?? null,
      resolved: Boolean(point),
    } as (typeof cached)[number]);
  }

  let jobsLocated = 0;
  for (const job of pending) {
    const hit = cachedByKey.get(geoCacheKey(job.location ?? ''));
    if (!hit?.resolved || hit.latitude === null || hit.longitude === null) continue;
    await prisma.job.update({
      where: { id: job.id },
      data: {
        latitude: hit.latitude,
        longitude: hit.longitude,
        city: hit.city,
        postalCode: hit.postalCode,
        inseeCode: hit.inseeCode,
      },
    });
    jobsLocated++;
  }

  return { pending: pending.length, lookedUp: results.size, jobsLocated, remaining };
}
