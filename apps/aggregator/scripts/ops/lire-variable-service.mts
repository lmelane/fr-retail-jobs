/**
 * LIRE LA VALEUR D'UNE VARIABLE D'UN SERVICE RAILWAY — quand Vercel refuse de la rendre.
 *
 * ── LE PROBLÈME QUE CE SCRIPT RÉSOUT ──────────────────────────────────────────────────────
 *
 * Une variable posée sur Vercel avec le type `Secret` n'est plus jamais lisible : ni dans le
 * tableau de bord, ni par `vercel env ls` (qui affiche « Hidden »), ni par `vercel env pull`
 * (qui écrit `[SENSITIVE]` à la place). C'est une protection délibérée, pas un défaut.
 *
 * Conséquence pratique, rencontrée le 2026-09-17 : pour poser `CATALOGUE_API_KEY` sur
 * l'environnement de préversion, il fallait la valeur de production... que Vercel ne rend pas.
 *
 * ── LA SOLUTION : REMONTER À LA SOURCE, PAS AU MIROIR ─────────────────────────────────────
 *
 * Une clé d'accès a DEUX porteurs : le client qui l'envoie (le site, sur Vercel) et le service
 * qui la vérifie (l'API, sur Railway). Vercel en garde une copie aveugle ; Railway en détient
 * l'originale, parce que son service doit la comparer à chaque requête.
 *
 * Railway rend les valeurs de son API GraphQL à qui détient le jeton du projet. C'est donc là
 * qu'on lit une clé perdue côté Vercel — pas dans une sauvegarde, pas dans un `.env.local` qui
 * porterait une valeur de développement (piège réel : celui du site pointait sur `localhost:3010`
 * avec une clé de test, inutilisable sur Vercel qui ne joint pas la machine du propriétaire).
 *
 * ── CE QUE CE SCRIPT ÉCRIT, ET OÙ ─────────────────────────────────────────────────────────
 *
 * La valeur va dans un FICHIER, jamais sur la sortie standard : un secret affiché dans un
 * terminal se retrouve dans l'historique du shell, dans les journaux de session et dans tout ce
 * qui capture la sortie. Le script n'imprime que le nom, la longueur et le chemin d'écriture.
 *
 * Le fichier de destination doit être hors du dépôt — un dossier temporaire de session. Aucun
 * secret ne doit être écrit dans l'arbre de travail, où un `git add` distrait le publierait.
 *
 * ── USAGE ─────────────────────────────────────────────────────────────────────────────────
 *
 *   npx tsx apps/aggregator/scripts/ops/lire-variable-service.mts <service> <NOM> <fichier>
 *
 *   service : aggregator | refresh | reconcile | api   (les noms de `railway-service.py`)
 *
 * Exemple :
 *   npx tsx apps/aggregator/scripts/ops/lire-variable-service.mts api CATALOGUE_API_KEY /tmp/cle.txt
 *
 * Puis, pour la poser sur Vercel sans qu'elle transite par le terminal :
 *   cat /tmp/cle.txt | tr -d '\n' | npx vercel env add CATALOGUE_API_KEY preview
 *
 * Effacer le fichier ensuite.
 */
import { realpathSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const [service, nom, destination] = process.argv.slice(2);
if (!service || !nom || !destination) {
  console.error('usage: lire-variable-service.mts <service> <NOM_VARIABLE> <fichier-de-destination>');
  process.exit(2);
}
/*
 * LE GARDE SE FAIT SUR LE CHEMIN RÉSOLU, jamais sur la chaîne telle qu'elle est tapée.
 *
 * Une première version comparait le texte de l'argument (`includes('catwalks-job-aggregator')`,
 * `startsWith('.')`). Deux façons de la contourner sans la moindre malice :
 *
 *  · un nom de fichier relatif NU — `cle.txt` — ne commence pas par un point et ne contient pas le
 *    nom du dépôt, mais s'écrit dans le dossier courant, qui est le dépôt quand on lance un script
 *    du dépôt ;
 *  · un lien symbolique posé hors du dépôt et pointant dedans passe le test de la chaîne, puis
 *    `writeFileSync` suit le lien.
 *
 * On résout donc le dossier de destination en chemin absolu SANS lien (`realpathSync` sur le
 * dossier, car le fichier n'existe pas encore), et on le compare à la racine du dépôt résolue de
 * la même façon. Un garde qui juge une apparence ne garde rien.
 */
const racineDepot = realpathSync(resolve(dirname(fileURLToPath(import.meta.url)), '../../../..'));
let dossierDestination: string;
try {
  dossierDestination = realpathSync(dirname(resolve(destination)));
} catch {
  console.error(`REFUSÉ : le dossier de ${destination} n'existe pas. Le créer d'abord, hors du dépôt.`);
  process.exit(2);
}
if (dossierDestination === racineDepot || dossierDestination.startsWith(`${racineDepot}/`)) {
  console.error('REFUSÉ : la destination est dans l\'arbre de travail. Un secret écrit dans le dépôt finit par y être commité.');
  process.exit(2);
}

/*
 * Le transport et la table des services vivent déjà dans `railway_api.py` et `railway-service.py`,
 * avec leur résolution d'identifiants et leur gestion des identifiants d'accès. On les réutilise
 * plutôt que d'en recopier une seconde version qui dériverait.
 */
const ops = dirname(fileURLToPath(import.meta.url));
const lecteur = `
import sys
sys.path.insert(0, ${JSON.stringify(ops)})
from railway_api import api
import importlib.util
spec = importlib.util.spec_from_file_location('rs', ${JSON.stringify(join(ops, 'railway-service.py'))})
rs = importlib.util.module_from_spec(spec); spec.loader.exec_module(rs)
config = rs.service_config(${JSON.stringify(service)})
q = ('query($project:String!,$env:String!,$service:String!)'
     '{variables(projectId:$project,environmentId:$env,serviceId:$service)}')
v = api(q, {'project': rs.PROJECT, 'env': rs.ENV, 'service': config['id']})['variables']
valeur = v.get(${JSON.stringify(nom)})
if valeur is None:
    sys.stderr.write('ABSENTE. Variables du service : ' + ', '.join(sorted(v)) + '\\n')
    sys.exit(1)
sys.stdout.write(valeur)
`;

let valeur: string;
try {
  valeur = execFileSync('python3', ['-c', lecteur], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] });
} catch {
  process.exit(1);
}

writeFileSync(destination, valeur, { mode: 0o600 });
console.log(JSON.stringify({ service, variable: nom, longueur: valeur.length, ecriteDans: destination }));
console.log('La valeur n\'est PAS affichée. Effacer le fichier après usage.');
