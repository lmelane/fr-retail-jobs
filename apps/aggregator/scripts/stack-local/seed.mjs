/**
 * Semis SYNTHÉTIQUE de la base backend de la stack locale, exécuté avec le
 * client Prisma du dépôt backend (chemin fourni) : une Maison de test, un
 * compte candidat de test et N offres en ligne, toutes marquées comme telles
 * (référence `STACK-TEST-…`, client « SYNTHETIQUE », textes explicites).
 * Idempotent : ne recrée rien de ce qui existe. Refuse toute base dont le nom
 * ne contient pas « test ».
 */
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const backendDir = process.env.BACKEND_DIR;
const url = process.env.DATABASE_URL ?? '';
const nombre = Number(process.env.SEED_OFFRES ?? 650);
const email = process.env.CANDIDATE_EMAIL, motDePasse = process.env.CANDIDATE_PASSWORD;
if (!backendDir || !url || !email || !motDePasse) throw new Error('BACKEND_DIR, DATABASE_URL, CANDIDATE_EMAIL et CANDIDATE_PASSWORD sont requis');
if (!/test/i.test(new URL(url).pathname)) throw new Error('Refus : la base semée doit porter « test » dans son nom');

const { PrismaClient, Prisma } = await import(pathToFileURL(path.join(backendDir, 'node_modules/@prisma/client/index.js')).href);
const bcrypt = (await import(pathToFileURL(path.join(backendDir, 'node_modules/bcryptjs/index.js')).href)).default;
const prisma = new PrismaClient({ datasources: { db: { url } } });
const enumValues = (name) => Prisma.dmmf.datamodel.enums.find((e) => e.name === name)?.values.map((v) => v.name) ?? [];

const MAISON = 'Maison Test Stack (synthétique)';
const TITRES = ['Conseiller de vente', 'Client Advisor', 'Store Manager', 'Visual Merchandiser', 'Beauty Advisor', 'Responsable de boutique adjoint',
  'Vendeur horlogerie', 'Sales Associate', 'Conseiller beauté', 'Assistant Store Manager', 'Retail Operations Coordinator', 'Maroquinier'];
const VILLES = [
  ['Paris', 'FR', '75008', 48.8566, 2.3522, 'Paris, France'], ['Lyon', 'FR', '69002', 45.764, 4.8357, 'Lyon, France'],
  ['New York', 'US', '10022', 40.7128, -74.006, 'New York, NY, USA'], ['London', 'GB', 'W1S 1RG', 51.5074, -0.1278, 'London, United Kingdom'],
  ['Toronto', 'CA', 'M5V', 43.6532, -79.3832, 'Toronto, Canada'], ['Berlin', 'DE', '10117', 52.52, 13.405, 'Berlin, Deutschland'],
  ['Milano', 'IT', '20121', 45.4642, 9.19, 'Milano, Italia'], ['Madrid', 'ES', '28001', 40.4168, -3.7038, 'Madrid, España'],
  ['Amsterdam', 'NL', '1012', 52.3676, 4.9041, 'Amsterdam, Nederland'], ['Sydney', 'AU', '2000', -33.8688, 151.2093, 'Sydney, Australia'],
  ['Genève', 'CH', '1204', 46.2044, 6.1432, 'Genève, Suisse'], ['Bruxelles', 'BE', '1000', 50.8503, 4.3517, 'Bruxelles, Belgique'],
  ['Shanghai', 'CN', '200000', 31.2304, 121.4737, 'Shanghai, China'],
];
const slugify = (s) => s.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

const resultat = { base: new URL(url).pathname.slice(1), maison: 'existante', candidat: 'existant', offresCreees: 0, offresTotal: 0 };
try {
  const maison = await prisma.maison.upsert({ where: { name: MAISON }, update: {}, create: { name: MAISON } });
  if (maison.createdAt && Date.now() - new Date(maison.createdAt).getTime() < 5000) resultat.maison = 'créée';
  const existant = await prisma.user.findUnique({ where: { email } });
  if (!existant) {
    await prisma.user.create({ data: { email, password: await bcrypt.hash(motDePasse, 12) } });
    resultat.candidat = 'créé';
  }
  const contrats = enumValues('ContractType').filter((v) => v !== 'SANS_EMPLOI'), temps = enumValues('WorkTime'), bandes = enumValues('ExperienceBand'), teletravail = enumValues('RemotePolicy');
  const secteurs = enumValues('Sector'), specialisations = enumValues('Specialization');
  const deja = new Set((await prisma.job.findMany({ where: { reference: { startsWith: 'STACK-TEST-' } }, select: { reference: true } })).map((j) => j.reference));
  const lignes = [];
  for (let i = 1; i <= nombre; i++) {
    const reference = `STACK-TEST-${String(i).padStart(4, '0')}`;
    if (deja.has(reference)) continue;
    const titre = TITRES[i % TITRES.length], v = VILLES[i % VILLES.length];
    const publieeIlYa = (i * 7919) % 30;
    lignes.push({
      reference, title: titre, slug: `${slugify(titre)}-${slugify(v[0])}-stack-test-${i}`,
      location: v[5], city: v[0], countryCode: v[1], postalCode: v[2], latitude: v[3], longitude: v[4],
      salary: 'Selon profil (offre synthétique)', salaryMin: 28000 + (i % 7) * 2000, salaryMax: 34000 + (i % 7) * 2500, salaryCurrency: 'EUR',
      brandDescription: 'OFFRE SYNTHÉTIQUE DE TEST — stack locale Catwalks. Aucune Maison réelle, aucun poste réel.',
      jobDescription: `OFFRE SYNTHÉTIQUE DE TEST n° ${i} (stack locale). ${titre} à ${v[0]} : ce texte existe pour tester la synchronisation, la recherche et la candidature en local.`,
      missions: 'Missions synthétiques : accueil, conseil, tenue du point de vente (données de test).',
      profile: 'Profil synthétique : aucune exigence réelle (données de test).',
      advantages: null, thumbnail: null, isActive: true, status: 'ONLINE',
      publishedAt: new Date(Date.now() - publieeIlYa * 86400000), validThrough: new Date(Date.now() + 60 * 86400000),
      contractType: contrats[i % contrats.length], workTime: temps[i % temps.length],
      experienceBand: bandes[i % bandes.length], remotePolicy: teletravail[i % teletravail.length],
      sectors: [secteurs[i % secteurs.length]], specializations: i % 3 === 0 ? [specialisations[i % specialisations.length]] : [],
      maisonId: maison.id, clientName: 'SYNTHETIQUE',
    });
  }
  for (let offset = 0; offset < lignes.length; offset += 100) {
    const r = await prisma.job.createMany({ data: lignes.slice(offset, offset + 100) });
    resultat.offresCreees += r.count;
  }
  resultat.offresTotal = await prisma.job.count({ where: { reference: { startsWith: 'STACK-TEST-' } } });
  resultat.outbox = Number(await prisma.catalogueOutbox.count());
  console.log(JSON.stringify(resultat));
} finally {
  await prisma.$disconnect();
}
