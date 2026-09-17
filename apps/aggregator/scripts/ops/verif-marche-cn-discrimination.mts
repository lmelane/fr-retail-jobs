/**
 * LE POUVOIR DE DISCRIMINATION D'UNE FACETTE — le taux ne suffit pas.
 *
 * Le registre le dit déjà pour `engagementType` : « le nombre de valeurs
 * compte autant que le taux de remplissage ». Ce script applique la même
 * question à la Chine, où `temps` affiche 81,9 % de couverture pour
 * 1 000 FULL_TIME contre 3 PART_TIME.
 *
 * Une facette dont 99,7 % des valeurs renseignées sont identiques n'est pas un
 * filtre : c'est un interrupteur qui ne change rien quand on l'actionne. Le
 * candidat coche « 全职 », le catalogue ne bouge pas, et il conclut que le
 * filtre est cassé.
 *
 * ── POURQUOI COMPARER AUX MARCHÉS DÉJÀ OUVERTS ────────────────────────────
 *
 * Parce qu'un chiffre seul ne dit pas s'il est anormal. Si les dix marchés
 * gravés exposaient tous `temps` avec 99 % d'une seule valeur, alors la Chine
 * serait la norme et refuser la facette chez elle seule serait arbitraire.
 * C'est l'inverse qu'il faut vérifier — et ce script le vérifie au lieu de le
 * supposer.
 *
 * Lecture seule. Rejouable.
 */
import { PrismaClient } from '@prisma/client';
import { CODES_MARCHE, MARCHES, facettesDuMarche } from '@catwalks/db/marches';

const p = new PrismaClient();
try {
  const codes = [...CODES_MARCHE, 'CN'];

  const lignes = await p.$queryRaw<Array<{ code: string; dim: string; v: string | null; n: bigint }>>`
    SELECT "countryCode" AS code, 'temps' AS dim, "workTime"::text AS v, count(*) AS n
      FROM "Job" WHERE "isActive" AND "countryCode" = ANY(${codes})
     GROUP BY "countryCode", "workTime"
    UNION ALL
    SELECT "countryCode", 'contrat', "employmentTerm"::text, count(*)
      FROM "Job" WHERE "isActive" AND "countryCode" = ANY(${codes})
     GROUP BY "countryCode", "employmentTerm"`;

  /* Part de la valeur DOMINANTE parmi les offres RENSEIGNÉES, par marché. */
  const par = new Map<string, Array<{ v: string | null; n: number }>>();
  for (const r of lignes) {
    const k = `${r.code}/${r.dim}`;
    if (!par.has(k)) par.set(k, []);
    par.get(k)!.push({ v: r.v, n: Number(r.n) });
  }

  console.log('marché  dim       renseignées  dominante              part');
  for (const dim of ['temps', 'contrat']) {
    for (const code of codes) {
      const vals = (par.get(`${code}/${dim}`) ?? []).filter((x) => x.v !== null);
      const total = vals.reduce((s, x) => s + x.n, 0);
      if (total === 0) continue;
      const top = vals.sort((a, b) => b.n - a.n)[0];
      const part = top.n / total;
      /* On ne signale que les marchés qui EXPOSENT la facette : ailleurs, le
       * seuil a déjà tranché et la concentration n'a pas de conséquence. */
      const expose = code === 'CN' ? '(à décider)' : (facettesDuMarche(code) as readonly string[]).includes(dim) ? 'exposée' : '—';
      console.log(
        `${code.padEnd(7)} ${dim.padEnd(9)} ${String(total).padStart(11)}  ${String(top.v).padEnd(20)} ${(part * 100).toFixed(1).padStart(5)} %  ${expose}`,
      );
    }
    console.log('');
  }

  /* La contre-épreuve : la même mesure sur `metier`, la facette dense. */
  const metiers = await p.$queryRaw<Array<{ code: string; v: string; n: bigint }>>`
    SELECT "countryCode" AS code, "jobFunction" AS v, count(*) AS n
      FROM "Job" WHERE "isActive" AND "countryCode" = ANY(${codes}) AND "jobFunction" IS NOT NULL
     GROUP BY "countryCode", "jobFunction"`;
  const parMetier = new Map<string, Array<number>>();
  for (const r of metiers) {
    if (!parMetier.has(r.code)) parMetier.set(r.code, []);
    parMetier.get(r.code)!.push(Number(r.n));
  }
  console.log('métier — part de la valeur dominante (contre-épreuve : une facette SAINE)');
  for (const code of codes) {
    const v = (parMetier.get(code) ?? []).sort((a, b) => b - a);
    const total = v.reduce((s, x) => s + x, 0);
    if (!total) continue;
    console.log(`${code.padEnd(7)} ${v.length} valeurs, dominante ${((v[0] / total) * 100).toFixed(1)} %`);
  }

  console.log('\noffresMesurees au registre (rappel) :',
    JSON.stringify(Object.fromEntries(CODES_MARCHE.map((c) => [c, MARCHES[c].offresMesurees]))));
} finally {
  await p.$disconnect();
}
