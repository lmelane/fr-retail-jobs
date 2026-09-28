// Témoin visuel D-471 — deux offres Catwalks dans la base JETABLE locale (jamais ailleurs). `--retirer` les supprime.
// Les témoins au navigateur de ce dossier (`temoin-*.mjs`, `parcours-reel.mjs`…) lisent ces deux offres.
//   DATABASE_URL=<base locale dont le nom contient « test »> npx tsx audits/2026-09-27/captures-d471/temoin-d471-seed.mts [--retirer]
import { prisma } from '@catwalks/db';
const u = new URL(process.env.DATABASE_URL ?? '');
if (!['127.0.0.1', 'localhost'].includes(u.hostname) || !/test/i.test(u.pathname)) throw new Error('base jetable locale exigée');
const ids = ['temoind471lancel', 'temoind471mandat'];
// `--jpy` : une troisième offre, au Japon et en yens, pour le témoin d'hydratation du salaire (D-473 §3). Hors du
// marché France : elle n'apparaît dans aucune liste française. `--jpy --retirer` la retire seule.
const JPY = 'temoind473jpy';
if (process.argv.includes('--jpy')) {
  if (process.argv.includes('--retirer')) console.log(await prisma.directOffer.deleteMany({ where: { id: JPY } }));
  else {
    const lancel = await prisma.directOffer.findUniqueOrThrow({ where: { id: ids[0] } });
    const { id: _id, ...reste } = lancel as Record<string, unknown>;
    const offre = { ...reste, id: JPY, slug: 'boutique-manager', title: 'Boutique manager', countryCode: 'JP', city: 'Tokyo',
      location: 'Tokyo', latitude: 35.6762, longitude: 139.6503, language: 'ja', salaryMin: 6_000_000, salaryMax: null, salaryCurrency: 'JPY',
      applyUrl: 'https://catwalks.io/offres/boutique-manager' };
    await prisma.directOffer.upsert({ where: { id: JPY }, create: offre as never, update: offre as never });
    console.log('témoin en yens en place', JPY);
  }
  await prisma.$disconnect();
  process.exit(0);
}
if (process.argv.includes('--retirer')) {
  console.log(await prisma.directOffer.deleteMany({ where: { id: { in: ids } } }));
} else {
  const commun = {
    version: BigInt(1), appliedSeq: BigInt(1), eligible: true, payloadHash: 'temoin-d471', payload: {}, correspondanceVersion: 6,
    anciensSlugs: [], sectorCodes: ['LEATHER_GOODS'], countryCode: 'FR', employmentTerm: 'PERMANENT', workTime: 'FULL_TIME',
    language: 'fr', validThrough: null, modifiedAt: new Date('2026-09-21T14:36:45Z'), postedAt: new Date('2026-09-21T14:36:45Z'),
    description: 'Au sein de la boutique, vous pilotez une équipe de conseillers et la relation avec une clientèle internationale.\n\nMissions : animation commerciale, recrutement, pilotage des indicateurs.\n\nProfil : cinq ans d’expérience en boutique de luxe.',
  };
  const offres = [
    { ...commun, id: ids[0], slug: 'directeur-rice-de-boutique-2', title: 'Directeur·rice de boutique', company: 'Lancel', maisonSlug: 'lancel',
      companyDomain: 'lancel.com', city: 'Lyon', location: 'Lyon', latitude: 45.764043, longitude: 4.835659,
      visuel: 'https://storage.googleapis.com/catwalks-storage-medias-publics/jobs/cmubcmbtf0001l0042ges9nhm-1790003893786.webp',
      applyUrl: 'https://catwalks.io/offres/directeur-rice-de-boutique-2', salaryMin: 45000, salaryMax: 55000, salaryCurrency: 'EUR', salaryPeriod: 'YEAR' },
    { ...commun, id: ids[1], slug: 'conseiller-ere-de-vente-en-alternance-paris', title: 'Conseiller·ère de vente en alternance, Paris', company: 'Catwalks',
      maisonSlug: null, companyDomain: null, city: 'Paris', location: 'Paris 1er, rue Saint-Honoré', latitude: 48.8636259, longitude: 2.3346742,
      employmentTerm: null, programType: 'APPRENTICESHIP',
      visuel: 'https://storage.googleapis.com/catwalks-storage-medias-publics/jobs/cmsxlvwfp000bl6044kq7slr1-1788873619402.webp',
      applyUrl: 'https://catwalks.io/offres/conseiller-ere-de-vente-en-alternance-paris' },
  ];
  for (const o of offres) await prisma.directOffer.upsert({ where: { id: o.id }, create: o as never, update: o as never });
  console.log('témoins en place', ids);
}
await prisma.$disconnect();
