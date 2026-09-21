/**
 * RÉCUPÉRATION DES CORPS DE CAPTURE — le contenu RAW, rendu réellement analysable.
 *
 *   AUDIT_DATABASE_URL='postgresql://catwalks_audit:...' \
 *     npx tsx apps/aggregator/scripts/ops/audit-corps.mts backups/corpus-<horodatage>
 *
 * ── POURQUOI CE SCRIPT EXISTE SÉPARÉMENT ───────────────────────────────────────────────────────
 *
 * `audit-corpus.mts` exporte les MÉTADONNÉES des corps (hash, tailles, disponibilité). Cela suffit
 * à compter et à relier, mais pas à ANALYSER : on ne peut pas savoir quelles dimensions une source
 * sans publication expose dans son RAW sans lire le RAW lui-même.
 *
 * Les corps ne reviennent pas dans le JSONL pour autant — ce sont des charges utiles de plusieurs
 * kilo-octets à méga-octets, et les inliner rendrait le corpus illisible en flux. Ils sont écrits
 * en FICHIERS SÉPARÉS, nommés par leur empreinte, donc DÉDUPLIQUÉS par construction : deux
 * captures au contenu identique partagent un seul fichier.
 *
 * ── LE VRAI PROBLÈME : LA DISPONIBILITÉ, PAS LE FORMAT ─────────────────────────────────────────
 *
 * Un corps vit à l'un de deux endroits, et parfois à aucun :
 *
 *   · `RawBlobBody` — les octets gzip en base ;
 *   · `RawBlobArchive` — un pointeur vers un stockage objet externe, APRÈS quoi `archiveRawBlob`
 *     SUPPRIME le corps de la base (`capture/store.ts:125`).
 *
 * Un corps archivé n'est donc lisible QUE si le stockage objet est joignable. Sans lui, la donnée
 * existe mais n'est pas disponible — et un corpus qui se déclarerait complet dans cet état
 * mentirait. Le manifeste distingue donc explicitement : exportés · disponibles · MANQUANTS.
 *
 * ── INTÉGRITÉ ─────────────────────────────────────────────────────────────────────────────────
 *
 * `readRawBlob` (code de PRODUCTION, réutilisé ici) vérifie deux empreintes : celle du gzip et
 * celle du contenu décompressé. Un corps corrompu lève au lieu d'être écrit silencieusement.
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { ouvrirAccesAudit } from './audit-acces.ts';
import { readRawBlob } from '../../src/capture/store.js';
import { objectStoreConfigured, objectStoreFromEnv } from '../../src/retention/objectStore.js';

const dossier = process.argv[2];
if (!dossier || !existsSync(`${dossier}/manifeste.json`)) {
  console.error(
    'Usage : audit-corps.mts <dossier-corpus>\n' +
    'Le dossier doit contenir un `manifeste.json` — un corpus sans manifeste est incomplet et ne ' +
    'doit pas être enrichi.',
  );
  process.exit(2);
}

const { prisma, profil } = await ouvrirAccesAudit();
console.log(`\n═══ CORPS DE CAPTURE ═══\n  rôle : ${profil.role}\n  corpus : ${dossier}`);

/*
 * L'ACCÈS AU STOCKAGE OBJET EST ÉPROUVÉ, PAS SUPPOSÉ.
 *
 * Un corps purgé de la base n'est lisible que par son archive. Or la présence d'une ligne
 * `RawBlobArchive` prouve seulement qu'une archive a été ENREGISTRÉE un jour — pas qu'elle est
 * joignable aujourd'hui, ni que ce processus a le droit de la lire. Traiter ce référencement
 * comme une preuve de disponibilité ferait passer des corps inaccessibles pour récupérés.
 *
 * On construit donc le store s'il est configuré, et on le DIT quand il ne l'est pas : les corps
 * archivés seront alors comptés MANQUANTS, ce qui est la vérité.
 */
let store: ReturnType<typeof objectStoreFromEnv> | undefined;
let etatStockage: string;
if (!objectStoreConfigured()) {
  etatStockage = 'NON CONFIGURÉ — les corps purgés de la base seront comptés MANQUANTS';
} else {
  try {
    store = objectStoreFromEnv();
    etatStockage = 'configuré';
  } catch (e) {
    etatStockage = `configuration REFUSÉE : ${String(e).slice(0, 120)}`;
  }
}
console.log(`  stockage objet : ${etatStockage}\n`);

/** Les empreintes à récupérer, lues depuis les métadonnées déjà exportées. */
type Meta = { hash: string; byteLength: number; corps_en_base: boolean; corps_archive: boolean };
const metas: Meta[] = readFileSync(`${dossier}/corps-metadonnees.jsonl`, 'utf8')
  .split('\n').filter(Boolean).map((l) => JSON.parse(l) as Meta);

const dossierCorps = `${dossier}/corps`;
mkdirSync(dossierCorps, { recursive: true });

const resultat = {
  metadonneesExportees: metas.length,
  disponibles: 0,
  manquants: [] as Array<{ hash: string; motif: string }>,
  octetsEcrits: 0,
  integriteVerifiee: true,
};

for (const [i, meta] of metas.entries()) {
  // Déduplication par empreinte : un contenu déjà écrit n'est pas relu.
  const chemin = `${dossierCorps}/${meta.hash.slice(0, 2)}/${meta.hash}.gz`;
  if (existsSync(chemin)) { resultat.disponibles += 1; continue; }

  try {
    /*
     * `readRawBlob` lit la base en priorité, puis l'archive via `store`. Sans store joignable,
     * il lève pour un corps purgé — comportement VOULU : un corps hors de portée est MANQUANT,
     * et le dire vaut mieux que de laisser croire qu'il a été récupéré.
     */
    const octets = await readRawBlob(prisma, meta.hash, store);
    mkdirSync(`${dossierCorps}/${meta.hash.slice(0, 2)}`, { recursive: true });
    const compresse = gzipSync(octets);
    writeFileSync(chemin, compresse);
    resultat.disponibles += 1;
    resultat.octetsEcrits += compresse.byteLength;
  } catch (e) {
    const message = String(e);
    resultat.manquants.push({
      hash: meta.hash,
      motif: meta.corps_archive && !meta.corps_en_base
        ? 'archivé hors base, stockage objet non joignable depuis ce corpus'
        : message.slice(0, 160),
    });
    // Une empreinte qui ne correspond pas n'est pas une indisponibilité : c'est une CORRUPTION.
    if (/integrity mismatch/i.test(message)) resultat.integriteVerifiee = false;
  }
  if ((i + 1) % 500 === 0) console.log(`  … ${i + 1}/${metas.length}`);
}

/*
 * LE MANIFESTE DIT LA VÉRITÉ SUR LA COMPLÉTUDE DU CONTENU. `corpsComplet` n'est vrai que si
 * AUCUN corps ne manque : un corpus dont les contenus sont partiellement inaccessibles peut
 * servir à compter, jamais à conclure sur ce que les sources exposent.
 */
const manifeste = JSON.parse(readFileSync(`${dossier}/manifeste.json`, 'utf8')) as Record<string, unknown>;
manifeste.corps = {
  stockageObjet: etatStockage,
  metadonneesExportees: resultat.metadonneesExportees,
  disponibles: resultat.disponibles,
  manquants: resultat.manquants.length,
  detailManquants: resultat.manquants.slice(0, 50),
  octetsEcrits: resultat.octetsEcrits,
  integriteVerifiee: resultat.integriteVerifiee,
  corpsComplet: resultat.manquants.length === 0 && resultat.integriteVerifiee,
  dossier: 'corps/<2 premiers caractères du hash>/<hash>.gz',
};
writeFileSync(`${dossier}/manifeste.json`, `${JSON.stringify(manifeste, null, 2)}\n`, 'utf8');

console.log(`\n  métadonnées : ${resultat.metadonneesExportees}`);
console.log(`  disponibles : ${resultat.disponibles}`);
console.log(`  MANQUANTS   : ${resultat.manquants.length}`);
console.log(`  intégrité   : ${resultat.integriteVerifiee ? 'vérifiée' : '✗ CORRUPTION DÉTECTÉE'}`);

await prisma.$disconnect();

if (resultat.manquants.length || !resultat.integriteVerifiee) {
  console.log(`\n✗ CORPUS RAW INCOMPLET — ${resultat.manquants.length} corps inaccessible(s).`);
  console.log('  Le manifeste porte `corpsComplet: false`. Les analyses de CONTENU sont');
  console.log('  impossibles sur ces captures ; les comptages restent valides.');
  for (const m of resultat.manquants.slice(0, 5)) console.log(`    ${m.hash.slice(0, 12)}… : ${m.motif}`);
  process.exit(1);
}
console.log(`\n✓ CORPUS RAW COMPLET — tous les corps sont disponibles et vérifiés.\n`);
