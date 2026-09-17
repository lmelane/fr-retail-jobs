/**
 * LA CHINE A-T-ELLE DEUX DIMENSIONS, OU UNE SEULE ? — la mesure qui tranche.
 *
 * ── LA THÈSE, VENUE D'UNE SOURCE INDÉPENDANTE ─────────────────────────────
 *
 * Le relevé des libellés chez les sites d'emploi chinois (zhaopin.com, Indeed
 * CN) montre qu'il n'existe PAS de facette « type de contrat » en Chine. Les
 * sites chinois servent UNE seule facette, `工作性质`, dont les valeurs
 * mélangent ce que le français sépare en deux : 全职 / 兼职 (le rythme) y
 * voisine avec 合同工 / 临时工 / 外包 (la durée).
 *
 * Ce n'est pas un trou de traduction, c'est une différence de STRUCTURE de
 * marché : la distinction CDI/CDD qui organise les annonces françaises n'est
 * pas la façon dont un candidat chinois cherche.
 *
 * ── POURQUOI ON NE S'ARRÊTE PAS AU RELEVÉ ─────────────────────────────────
 *
 * Parce qu'un relevé de sites est un témoignage sur le marché, pas une preuve
 * sur NOTRE catalogue. Si la thèse est vraie, elle doit laisser une trace
 * MESURABLE dans nos données : le croisement des deux colonnes doit être
 * quasi dégénéré — presque tout dans une seule case — alors qu'il doit être
 * réellement croisé sur un marché où les deux dimensions existent.
 *
 * La contre-épreuve française est donc la moitié qui compte : sans elle, un
 * croisement concentré pourrait tout aussi bien venir de notre normalisation.
 *
 * Lecture seule. Rejouable.
 */
import { PrismaClient } from '@prisma/client';

const p = new PrismaClient();
try {
  const cn = await p.$queryRaw<Array<{ contrat: string | null; temps: string | null; n: bigint }>>`
    SELECT "employmentTerm"::text AS contrat, "workTime"::text AS temps, count(*) AS n
      FROM "Job" WHERE "isActive" AND "countryCode" = 'CN'
     GROUP BY 1, 2 ORDER BY count(*) DESC`;

  console.log('=== CHINE — croisement contrat × temps ===');
  for (const x of cn) {
    console.log(`  ${String(x.contrat).padEnd(12)} ${String(x.temps).padEnd(11)} ${Number(x.n)}`);
  }

  /* La concentration parmi les offres où LES DEUX sont renseignées. */
  const deux = cn.filter((x) => x.contrat !== null && x.temps !== null);
  const totalDeux = deux.reduce((s, x) => s + Number(x.n), 0);
  const domDeux = Math.max(...deux.map((x) => Number(x.n)), 0);
  console.log(`\noffres CN avec les DEUX dimensions : ${totalDeux}`);
  console.log(`case dominante : ${totalDeux ? ((domDeux / totalDeux) * 100).toFixed(1) : '—'} %`);

  const fr = await p.$queryRaw<Array<{ contrat: string | null; temps: string | null; n: bigint }>>`
    SELECT "employmentTerm"::text AS contrat, "workTime"::text AS temps, count(*) AS n
      FROM "Job"
     WHERE "isActive" AND "countryCode" = 'FR'
       AND "employmentTerm" IS NOT NULL AND "workTime" IS NOT NULL
     GROUP BY 1, 2 ORDER BY count(*) DESC`;

  console.log('\n=== CONTRE-ÉPREUVE FRANCE — deux dimensions réellement distinctes ===');
  for (const x of fr.slice(0, 8)) {
    console.log(`  ${String(x.contrat).padEnd(12)} ${String(x.temps).padEnd(11)} ${Number(x.n)}`);
  }
  const totalFr = fr.reduce((s, x) => s + Number(x.n), 0);
  const domFr = Math.max(...fr.map((x) => Number(x.n)), 0);
  console.log(`\noffres FR avec les DEUX : ${totalFr}`);
  console.log(`case dominante : ${((domFr / totalFr) * 100).toFixed(1)} %`);
  console.log(`\nLECTURE : si la case dominante chinoise écrase la française, les deux`);
  console.log(`colonnes ne portent qu'UNE information en Chine — et deux filtres`);
  console.log(`séparés y proposeraient au candidat un choix qui n'existe pas.`);
} finally {
  await p.$disconnect();
}
