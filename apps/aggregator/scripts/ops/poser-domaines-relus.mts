/**
 * POSER DES DOMAINES RELUS SUR DES SOCIÉTÉS — inspection par défaut, écriture sur `--ecrire=<empreinte>`.
 *
 *   # inspection, n'écrit RIEN, imprime le plan et son empreinte :
 *   python3 apps/aggregator/scripts/ops/db.py readonly npx tsx \
 *     apps/aggregator/scripts/ops/poser-domaines-relus.mts <fichier.json>
 *
 *   # écriture, hors RUN, avec l'empreinte imprimée par l'inspection :
 *   python3 apps/aggregator/scripts/ops/db.py production npx tsx \
 *     apps/aggregator/scripts/ops/poser-domaines-relus.mts <fichier.json> --ecrire=<empreinte>
 *
 * Le plan (`domaines-relus.ts`) n'écrit qu'une ligne relue, prouvée, de confiance haute, sur la société
 * relue ET sous le nom relu, et seulement si son domaine est encore celui que la relecture a vu (vide, ou la
 * valeur fausse désignée). L'empreinte lie l'écriture au plan inspecté : si la base ou le fichier ont changé
 * entre les deux, rien ne s'écrit. Tout ou rien, en une transaction ; un RUN en cours refuse l'écriture.
 *
 * Ne crée, ne fusionne ni ne renomme aucune société ; ne touche ni aux offres ni aux identités.
 */
import { PrismaClient } from '@prisma/client';
import { readFileSync } from 'node:fs';
import { ecrire, empreinte, planifier, rapport, validerFichier, type EtatSociete } from './domaines-relus.js';

const fichierArg = process.argv.slice(2).find((a) => !a.startsWith('-'));
const demandee = process.argv.find((a) => a.startsWith('--ecrire='))?.slice('--ecrire='.length);
if (!fichierArg || process.argv.includes('--ecrire')) {
  console.error('Usage : poser-domaines-relus.mts <fichier.json> [--ecrire=<empreinte de l’inspection>]');
  process.exit(2);
}
const url = process.env.DB_URL ?? process.env.DATABASE_URL;
if (!url) { console.error('DB_URL (ou DATABASE_URL) manquante.'); process.exit(1); }
const prisma = new PrismaClient({ datasources: { db: { url } } });

try {
  const fichier = validerFichier(JSON.parse(readFileSync(fichierArg, 'utf8')));
  const lus = await prisma.company.findMany({
    where: { id: { in: fichier.domaines.map((d) => d.id) } },
    select: { id: true, name: true, domain: true, mergedIntoId: true },
  });
  const actions = planifier(fichier, new Map<string, EtatSociete>(lus.map((c) => [c.id, c])));
  console.log(`\n${rapport(fichier, actions)}\n\nempreinte du plan : ${empreinte(fichier.lot, actions)}\n`);

  if (!demandee) {
    console.log('INSPECTION SEULEMENT : rien n’a été écrit. Écrire : relancer avec --ecrire=<empreinte ci-dessus>.\n');
  } else {
    const r = await ecrire(prisma, fichier, actions, demandee);
    if ('refus' in r) {
      console.error(`REFUS : ${r.refus}.`);
      process.exitCode = 3;
    } else {
      console.log(`   ${r.ecrites} domaine(s) écrit(s) · relu(s) conforme(s) en base : ${r.conformes}/${r.attendues}\n`);
      if (r.conformes !== r.attendues) process.exitCode = 1;
    }
  }
} finally {
  await prisma.$disconnect();
}
