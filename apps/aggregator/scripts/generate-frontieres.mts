/**
 * LE TRACÉ DES FRONTIÈRES, REFERENTIEL VERSIONNÉ (D-444) — mise à jour explicite, jamais exécutée par l'ingestion
 * ni par un déploiement.
 *
 * Source : Natural Earth, « Admin 0 – Countries », échelle 1:10 000 000, version 5.1.1, domaine public
 * (https://www.naturalearthdata.com/about/terms-of-use/). D-444 retient cette précision parce qu'elle est la seule qui
 * classe Nice, New York et Monaco sans erreur (au 1:50 000 000, un point du littoral tombe en mer).
 *
 * Le fichier produit (`data/reference/frontieres-ne10m.json.gz`) garde, pour chacune des 258 entités, son code pays
 * (champ `ISO_A2_EH`, « exceptions handled » : la France, dont `ISO_A2` vaut -99 parce que l'entité porte ses
 * départements d'outre-mer, y vaut FR) et ses anneaux, coordonnées quantifiées au millionième de degré (11 cm, quatre
 * ordres de grandeur sous la précision de l'échelle) et codées par différences. Une entité sans code (-99 : Chypre du
 * Nord, Somaliland, zones disputées) garde `null` : un point qui y tombe s'abstient (D-435).
 *
 * Reproduire :
 *   curl -fsSLO https://naciscdn.org/naturalearth/10m/cultural/ne_10m_admin_0_countries.zip
 *   unzip ne_10m_admin_0_countries.zip -d <dossier>
 *   npx tsx apps/aggregator/scripts/generate-frontieres.mts --source-dir=<dossier> [--write]
 * Sans `--write`, le script vérifie que le fichier versionné est exactement celui que produit la source épinglée.
 */
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { gunzipSync, gzipSync } from 'node:zlib';

const SORTIE = fileURLToPath(new URL('../data/reference/frontieres-ne10m.json.gz', import.meta.url));
const BASE = 'ne_10m_admin_0_countries';
/** Les empreintes de l'archive officielle 5.1.1 et de ses fichiers, relevées le 25/09/2026. */
const EPINGLE = {
  version: '5.1.1',
  url: 'https://naciscdn.org/naturalearth/10m/cultural/ne_10m_admin_0_countries.zip',
  zip: 'ce1ac7036499a0edd641fbc093cd209a98f96a49d2eca8480aaacad35138a7f6',
  shp: '7ce119ef6342e43cff7c0c3004e0911ab7ec1988a14734372031d2012180e7bc',
  dbf: 'c5dbd3dd5fd7e2ef49051fc88562c03819e8ea63a382642df6eadd1243bf4b49',
};
export const QUANTIFICATION = 1_000_000;

const sha256 = (octets: Buffer) => createHash('sha256').update(octets).digest('hex');

type Enregistrement = Record<string, string>;

/** Les enregistrements du fichier dBase : en-tête, descripteurs de champs, lignes à largeur fixe, en UTF-8 (`.cpg`). */
function lireDbf(octets: Buffer): Enregistrement[] {
  const n = octets.readUInt32LE(4), entete = octets.readUInt16LE(8), longueur = octets.readUInt16LE(10);
  const champs: { nom: string; taille: number }[] = [];
  for (let o = 32; o < entete - 1; o += 32) champs.push({ nom: octets.toString('latin1', o, o + 11).replace(/\0.*$/s, ''), taille: octets[o + 16] });
  const lignes: Enregistrement[] = [];
  for (let i = 0, debut = entete; i < n; i++, debut += longueur) {
    let p = debut + 1;
    const ligne: Enregistrement = {};
    for (const champ of champs) {
      ligne[champ.nom] = octets.toString('utf8', p, p + champ.taille).replace(/\0/g, '').trim();
      p += champ.taille;
    }
    lignes.push(ligne);
  }
  return lignes;
}

/** Les anneaux de chaque polygone du fichier de formes (type 5, polygone ; tout autre type arrête le script). */
function lireShp(octets: Buffer): number[][][][] {
  const entites: number[][][][] = [];
  for (let pos = 100; pos < octets.length;) {
    const taille = octets.readInt32BE(pos + 4) * 2, c = pos + 8;
    const type = octets.readInt32LE(c);
    if (type !== 5) throw new Error(`Forme ${type} inattendue (polygone attendu)`);
    const parties = octets.readInt32LE(c + 36), points = octets.readInt32LE(c + 40);
    const debuts = Array.from({ length: parties }, (_, k) => octets.readInt32LE(c + 44 + 4 * k));
    const base = c + 44 + 4 * parties;
    entites.push(debuts.map((a, k) => {
      const b = k + 1 < parties ? debuts[k + 1] : points;
      return Array.from({ length: b - a }, (_, q) => [octets.readDoubleLE(base + 16 * (a + q)), octets.readDoubleLE(base + 16 * (a + q) + 8)]);
    }));
    pos = c + taille;
  }
  return entites;
}

/** Un anneau en entiers (millionièmes de degré) codés par différences : x0, y0, dx1, dy1… */
function coder(anneau: number[][]): number[] {
  const sortie: number[] = [];
  let px = 0, py = 0;
  for (const [x, y] of anneau) {
    const X = Math.round(x * QUANTIFICATION), Y = Math.round(y * QUANTIFICATION);
    sortie.push(X - px, Y - py);
    px = X; py = Y;
  }
  return sortie;
}

function construire(dossier: string): Buffer {
  const lire = (ext: string) => readFileSync(resolve(dossier, `${BASE}.${ext}`));
  const version = lire('VERSION.txt').toString('utf8').trim();
  if (version !== EPINGLE.version) throw new Error(`Version ${version} ; ${EPINGLE.version} attendue`);
  const shp = lire('shp'), dbf = lire('dbf');
  if (sha256(shp) !== EPINGLE.shp || sha256(dbf) !== EPINGLE.dbf) throw new Error('Les fichiers diffèrent de la source épinglée');
  const lignes = lireDbf(dbf), formes = lireShp(shp);
  if (lignes.length !== formes.length) throw new Error('Formes et attributs ne correspondent pas');
  const entites = lignes.map((ligne, i) => {
    const code = ligne.ISO_A2_EH;
    return [/^[A-Z]{2}$/.test(code) ? code : null, ligne.NAME, formes[i].map(coder)];
  });
  const document = {
    format: 1,
    source: {
      nom: 'Natural Earth — Admin 0 – Countries', echelle: '1:10m', version: EPINGLE.version, url: EPINGLE.url,
      zipSha256: EPINGLE.zip, shpSha256: EPINGLE.shp, dbfSha256: EPINGLE.dbf,
      licence: 'Domaine public — https://www.naturalearthdata.com/about/terms-of-use/',
    },
    champPays: 'ISO_A2_EH',
    quantification: QUANTIFICATION,
    entites,
  };
  return Buffer.from(JSON.stringify(document), 'utf8');
}

const { values } = parseArgs({ options: { 'source-dir': { type: 'string' }, write: { type: 'boolean' } } });
if (!values['source-dir']) throw new Error('--source-dir=<dossier de l’archive décompressée> requis');
const contenu = construire(values['source-dir']);
if (values.write) {
  writeFileSync(SORTIE, gzipSync(contenu, { level: 9 }));
  console.log(JSON.stringify({ ecrit: SORTIE, contenuSha256: sha256(contenu), octets: contenu.length }));
} else {
  const actuel = gunzipSync(readFileSync(SORTIE));
  if (!actuel.equals(contenu)) throw new Error('Le fichier versionné diffère de la source épinglée : relancer avec --write après revue');
  console.log(JSON.stringify({ verifie: SORTIE, contenuSha256: sha256(contenu) }));
}
