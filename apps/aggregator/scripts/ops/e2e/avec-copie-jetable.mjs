#!/usr/bin/env node
// Lanceur en ÉCRITURE réservé à une copie jetable de la base de répétition, servie par un conteneur
// Docker local : il sert à la migrer et à reconstruire sa projection de recherche avant un reçu E2E.
// Procédure : docs/architecture/emplois-e2e.md, section « Preuve sur copie jetable ».
//
// L'accès vient du dossier désigné par CW_COPIE_JETABLE (chemin absolu, hors du dépôt) :
// throwaway-access.json (PGHOST, PGPORT, PGUSER, PGPASSWORD, PGDATABASE), throwaway.port, throwaway.name.
// Refus (sortie 3, sans lancer de commande ni ouvrir de connexion) : dossier absent ou dans le dépôt,
// hôte autre que 127.0.0.1, port autre que celui que Docker publie pour le conteneur
// catwalks-e2e-throwaway-AAAAMMJJhhmmss, base autre que catwalks_consolide_rehearsal, identifiants
// incomplets, formes Prisma reset, push ou shadow, argument portant une URL (`://`, `--url`, `--from-url`…) ou un
// schéma autre que packages/db/prisma/schema.prisma. Aucun .env n'est lu ; DATABASE_URL, DIRECT_URL et
// PG* hérités sont retirés avant de poser l'URL de la copie. Ne jamais y mettre une URL de production.
import { readFileSync, realpathSync } from 'node:fs';
import { execFileSync, spawn } from 'node:child_process';
import { isAbsolute, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const BASE = 'catwalks_consolide_rehearsal';
const refus = (motif) => { console.error(`REFUS : ${motif}`); process.exit(3); };

const brut = process.env.CW_COPIE_JETABLE;
if (!brut || !isAbsolute(brut)) refus('CW_COPIE_JETABLE doit désigner, en chemin absolu, le dossier d’accès de la copie');
let dossier;
try { dossier = realpathSync(brut); } catch { refus('dossier d’accès de la copie introuvable'); }
const depot = realpathSync(fileURLToPath(new URL('../../../../../', import.meta.url)));
const chemin = relative(depot, dossier);
if (!(chemin === '..' || chemin.startsWith(`..${sep}`) || isAbsolute(chemin))) refus('le dossier d’accès doit rester hors du dépôt');

let acces, port, nom;
try {
  acces = JSON.parse(readFileSync(join(dossier, 'throwaway-access.json'), 'utf8'));
  port = readFileSync(join(dossier, 'throwaway.port'), 'utf8').trim();
  nom = readFileSync(join(dossier, 'throwaway.name'), 'utf8').trim();
} catch { refus('fichiers d’accès de la copie absents ou invalides'); }
if (!/^catwalks-e2e-throwaway-\d{14}$/.test(nom)) refus('nom de conteneur inattendu');
if (!/^\d{1,5}$/.test(port)) refus('port invalide');
if (acces?.PGHOST !== '127.0.0.1') refus('hôte 127.0.0.1 requis');
if (String(acces.PGPORT) !== port) refus('port différent du conteneur jetable');
if (acces.PGDATABASE !== BASE) refus('nom de base inattendu');
if (typeof acces.PGUSER !== 'string' || !acces.PGUSER || typeof acces.PGPASSWORD !== 'string' || !acces.PGPASSWORD) refus('identifiants incomplets');
const args = process.argv.slice(2);
if (!args.length) refus('commande requise');
if (args.some((a) => /shadow-database-url|from-migrations|to-migrations|migrate\s*reset|^reset$|db\s*push|^push$/i.test(a))) refus('argument interdit');
// La seule base atteinte est la copie posée dans l'environnement : aucune URL de base ne passe par un argument
// (`--url`, `--from-url`, `--to-url`, une URL `postgresql://`…), qui l'emporterait sur elle.
if (args.some((a) => a.includes('://') || /^--[a-z-]*url\b/i.test(a))) refus('URL de base en argument interdite');
// Un autre schéma pourrait désigner une autre base (`datasource`) : seul celui du dépôt est admis.
const SCHEMA = realpathSync(join(depot, 'packages/db/prisma/schema.prisma'));
args.forEach((a, i) => {
  if (a !== '--schema' && !a.startsWith('--schema=')) return;
  const valeur = a === '--schema' ? args[i + 1] : a.slice('--schema='.length);
  let reel;
  try { reel = valeur ? realpathSync(valeur) : undefined; } catch { reel = undefined; }
  if (reel !== SCHEMA) refus('seul le schéma packages/db/prisma/schema.prisma est admis');
});

// Le port doit appartenir au conteneur jetable, publié sur 127.0.0.1 seulement (jamais un tunnel).
let publie;
try { publie = execFileSync('docker', ['port', nom, '5432/tcp'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); }
catch { refus(`conteneur ${nom} introuvable ou Docker indisponible`); }
if (publie !== `127.0.0.1:${port}`) refus(`le conteneur jetable n’expose pas 127.0.0.1:${port}`);

const url = new URL(`postgresql://127.0.0.1:${port}/${BASE}`);
url.username = acces.PGUSER; url.password = acces.PGPASSWORD;
const relue = new URL(url.href);
if (relue.hostname !== '127.0.0.1' || relue.port !== port || relue.pathname !== `/${BASE}`) refus('URL construite incohérente');
const env = { ...process.env };
for (const cle of Object.keys(env)) if (/^(DATABASE_URL|DIRECT_URL|PG[A-Z]+)$/.test(cle)) delete env[cle];
Object.assign(env, { DATABASE_URL: url.href, DIRECT_URL: url.href });
console.error(`[copie-jetable] cible 127.0.0.1:${port}/${BASE} (conteneur ${nom})`);
const enfant = spawn(args[0], args.slice(1), { stdio: 'inherit', env });
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => enfant.kill(signal));
enfant.on('error', () => { console.error('Échec du lancement de la commande'); process.exit(1); });
enfant.on('exit', (code, signal) => process.exit(code ?? (signal ? 1 : 0)));
