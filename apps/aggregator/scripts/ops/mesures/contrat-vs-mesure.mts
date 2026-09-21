/**
 * LE CONTRAT DES MARCHÉS FACE AU CORPUS — couverture DÉCLARÉE vs MESURÉE.
 *
 * `marches.ts` porte des `couverture` figées au 15/09. Une facette peut donc être exposée sur une
 * donnée devenue rare, ou cachée alors que la donnée suffit — et aucun code ne le signale.
 * Ce script lit le corpus (pas la production) et nomme la conséquence pour le candidat.
 */
import { readFileSync } from 'node:fs';
import { MARCHES, SEUIL_AFFICHAGE_FACETTE } from '@catwalks/db/marches';

const dossier = process.argv[2];
if (!dossier) { console.error('usage: contrat-vs-mesure.mts <dossier-corpus>'); process.exit(2); }

type Offre = Record<string, unknown> & { countryCode: string | null; publiable: boolean };
const offres: Offre[] = readFileSync(`${dossier}/offres.jsonl`, 'utf8')
  .split('\n').filter(Boolean).map((l) => JSON.parse(l) as Offre).filter((o) => o.publiable);

/** La colonne canonique qui porte chaque dimension du contrat. */
const COLONNE: Record<string, string | null> = {
  contrat: 'employmentTerm', temps: 'workTime', programme: 'programType', saisonnier: 'isSeasonal',
  metier: 'occupationCode', teletravail: 'workplaceType', rythme: 'workSchedule',
  nature: 'engagementType', experience: 'experienceYears', etudes: 'educationLevel', salaire: 'salaryMin',
};

const rempli = (o: Offre, c: string) => o[c] !== null && o[c] !== undefined && String(o[c]).trim() !== '';
let divergences = 0;
const lignes: string[] = ['marche;dimension;declaree;mesuree;offres;verdict_declare;verdict_mesure;consequence'];

for (const [code, m] of Object.entries(MARCHES) as Array<[string, any]>) {
  const pays: string[] = m.pays ?? [code];
  const dumarche = offres.filter((o) => pays.includes(o.countryCode ?? ''));
  const dims = Object.keys(m.couverture ?? {});
  if (!dims.length || !dumarche.length) continue;

  const ecart = m.offresMesurees ? Math.round(((dumarche.length - m.offresMesurees) / m.offresMesurees) * 100) : 0;
  const entetes: string[] = [];

  for (const dim of dims) {
    const col = COLONNE[dim];
    if (!col) continue;
    const mesuree = dumarche.filter((o) => rempli(o, col)).length / dumarche.length;
    const declaree = Number(m.couverture[dim] ?? 0);
    const libelle = m.libelles?.[dim] !== undefined;
    const affDeclare = declaree >= SEUIL_AFFICHAGE_FACETTE && libelle;
    const affMesure = mesuree >= SEUIL_AFFICHAGE_FACETTE && libelle;

    let consequence = '';
    if (affDeclare && !affMesure) { consequence = 'FACETTE AFFICHEE SUR DONNEE DEVENUE RARE'; divergences++; }
    else if (!affDeclare && affMesure && libelle) { consequence = 'facette cachee alors que la donnee suffit'; divergences++; }
    else if (!libelle && mesuree >= SEUIL_AFFICHAGE_FACETTE) { consequence = 'donnee suffisante, AUCUN LIBELLE declare'; divergences++; }

    if (consequence) entetes.push(`    ${dim.padEnd(12)} declaree ${(declaree*100).toFixed(0).padStart(3)}%  mesuree ${(mesuree*100).toFixed(0).padStart(3)}%  ${consequence}`);
    lignes.push([code, dim, declaree.toFixed(3), mesuree.toFixed(3), dumarche.length,
      affDeclare ? 'affichee' : 'cachee', affMesure ? 'affichee' : 'cachee', consequence].join(';'));
  }
  if (entetes.length) {
    console.log(`\n── ${code} · declare ${m.offresMesurees} offres · mesure ${dumarche.length} (${ecart > 0 ? '+' : ''}${ecart} %)`);
    for (const e of entetes) console.log(e);
  }
}
console.log(`\n═══ ${divergences} divergence(s) entre le contrat et le corpus ═══`);
