/**
 * Contrôle de cohérence du catalogue seed (`data/seeds/sources.csv`), sans réseau
 * ni base : charge le catalogue, dérive pour chaque ligne sa clé de source et sa
 * clé de tenant, et signale toute collision AVANT que l'import ne la rencontre.
 *
 * La contrainte `tenantKey` unique est ce qui a révélé les 17 lignes doublons du
 * catalogue (Coty ×5, Condé Nast ×4…). La rejouer ici rend la collision visible
 * au moment où on ajoute une ligne, pas au démarrage du conteneur.
 *
 * Usage : npx tsx scripts/ops/verif-catalogue-coherence.mts [--maison="Ba&sh"]
 * Sortie : code 1 si une collision existe.
 */
import { loadSourceCatalog, tierFor, sourceKeyFor } from '../../src/connectors/sourceCatalog.js';
import { tenantKeyOf } from '../../src/connectors/sourceStore.js';

const catalogue = loadSourceCatalog();
const collisions: string[] = [];
const parCle = new Map<string, string>();
const parTenant = new Map<string, string>();

for (const source of catalogue) {
  const cle = sourceKeyFor(source);
  const tenant = tenantKeyOf(source.kind, source.entryUrl, source.careersDomain, source.maison);
  if (parCle.has(cle)) collisions.push(`cle "${cle}" partagee par ${parCle.get(cle)} et ${source.maison}`);
  if (parTenant.has(tenant)) collisions.push(`tenant "${tenant}" partage par ${parTenant.get(tenant)} et ${source.maison}`);
  parCle.set(cle, source.maison);
  parTenant.set(tenant, source.maison);
}

console.log(`sources chargees : ${catalogue.length}`);
console.log(`cles distinctes  : ${parCle.size}`);
console.log(`tenants distincts: ${parTenant.size}`);

const cible = process.argv.find((a) => a.startsWith('--maison='))?.slice('--maison='.length);
if (cible) {
  const source = catalogue.find((s) => s.maison === cible);
  if (!source) {
    console.error(`\nAucune ligne pour la maison "${cible}"`);
    process.exit(1);
  }
  console.log(`\n${JSON.stringify({
    maison: source.maison,
    key: sourceKeyFor(source),
    tenantKey: tenantKeyOf(source.kind, source.entryUrl, source.careersDomain, source.maison),
    kind: source.kind,
    tier: tierFor(source),
    config: JSON.parse(source.entryUrl || '{}'),
    robotsVerdict: source.robotsVerdict,
  }, null, 2)}`);
}

if (collisions.length > 0) {
  console.error(`\n${collisions.length} collision(s) :`);
  for (const c of collisions) console.error(`  - ${c}`);
  process.exit(1);
}
console.log('\nAucune collision de cle ni de tenant.');
