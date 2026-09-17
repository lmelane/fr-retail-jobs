/**
 * CE QUE LE NOUVEAU MOTEUR DE LANGUE CHANGERAIT — mesure intégrale, AUCUNE écriture.
 *
 * Rejoue `deciderLangue` (`lib/languageDetection.ts`) sur tout le catalogue actif et rend la
 * matrice de bascule : ancienne valeur → nouvelle, par source, par marché, avec la provenance et
 * la confiance. C'est la restitution exigée avant tout backfill.
 *
 * ── CE QUI EST UNE PREUVE, ET CE QUI N'EN EST PAS ─────────────────────────────────────────────
 *
 * **Preuve.** Les comptes : combien de lignes changent, dans quel sens, sur quelle source. Ils se
 * recomptent à l'identique en rejouant cette sonde.
 *
 * **Heuristique.** Le verdict du détecteur lui-même. Les mots vides et les plages d'écriture sont
 * des indices solides, pas une vérité terrain. Un désaccord entre l'ancienne et la nouvelle
 * valeur ne dit pas mécaniquement que la nouvelle est juste.
 *
 * **Incertitude assumée.** Les annonces dont la confiance reste basse, et celles qu'aucune des
 * deux méthodes ne classe. Elles ressortent `undefined` — et c'est le comportement voulu.
 *
 * Un taux d'accord n'est JAMAIS un taux d'exactitude : il dit que deux méthodes concordent, pas
 * qu'elles ont raison. L'échantillon de conflits, en fin de rapport, est là pour être lu à l'œil.
 *
 * ── USAGE ─────────────────────────────────────────────────────────────────────────────────────
 *
 *   python3 apps/aggregator/scripts/ops/db.py readonly npx tsx \
 *     audits/mesures-d435-d436/bascule-langue-2026-09-17.mts [limite]
 */
import { PrismaClient } from '@prisma/client';
import { deciderLangue } from '../../apps/aggregator/src/lib/languageDetection.js';

const LIMITE = Number(process.argv[2] ?? 0);
const db = new PrismaClient();

type Ligne = {
  id: string; titre: string; description: string | null;
  ancienne: string | null; declaree: string | null;
  pays: string | null; source: string | null;
};

const compter = <T>(map: Map<T, number>, cle: T) => map.set(cle, (map.get(cle) ?? 0) + 1);
const pct = (n: number, d: number) => (d ? `${((100 * n) / d).toFixed(1)} %` : '—');

try {
  console.log(`\nBASCULE DE LANGUE — simulation du ${new Date().toISOString().slice(0, 10)}, AUCUNE ÉCRITURE\n`);

  const total = await db.job.count({ where: { isActive: true } });
  const matrice = new Map<string, number>();
  const parProvenance = new Map<string, number>();
  const parSource = new Map<string, { change: number; total: number }>();
  const parMarche = new Map<string, { change: number; total: number; versNull: number; depuisNull: number }>();
  const conflits: Array<{ source: string; pays: string; ancienne: string; nouvelle: string; confiance: number; titre: string }> = [];

  let vues = 0, inchangees = 0, changees = 0, versNull = 0, depuisNull = 0;
  let curseur: string | undefined;

  for (;;) {
    const lot = await db.$queryRawUnsafe<Ligne[]>(`
      SELECT j.id, j.title AS titre, j.description, j.language AS ancienne,
             s.raw->>'language' AS declaree, j."countryCode" AS pays, s."sourceKey" AS source
        FROM "Job" j
        LEFT JOIN LATERAL (
          SELECT "sourceKey", raw FROM "JobSource"
           WHERE "jobId" = j.id AND "isActive" ORDER BY id LIMIT 1) s ON true
       WHERE j."isActive" ${curseur ? `AND j.id > '${curseur}'` : ''}
       ORDER BY j.id LIMIT 2000`);
    if (lot.length === 0) break;

    for (const l of lot) {
      vues++;
      const d = deciderLangue(l.declaree ?? l.ancienne ?? undefined, l.description ?? l.titre);
      const avant = l.ancienne ?? '∅';
      const apres = d.langue ?? '∅';
      compter(parProvenance, d.provenance);

      const source = l.source ?? '(sans source)';
      const marche = l.pays ?? '(sans pays)';
      const ps = parSource.get(source) ?? { change: 0, total: 0 };
      const pm = parMarche.get(marche) ?? { change: 0, total: 0, versNull: 0, depuisNull: 0 };
      ps.total++; pm.total++;

      if (avant === apres) inchangees++;
      else {
        changees++; ps.change++; pm.change++;
        compter(matrice, `${avant} → ${apres}`);
        if (apres === '∅') { versNull++; pm.versNull++; }
        if (avant === '∅') { depuisNull++; pm.depuisNull++; }
        if (avant !== '∅' && apres !== '∅' && conflits.length < 400) {
          conflits.push({ source, pays: marche, ancienne: avant, nouvelle: apres, confiance: d.confiance, titre: l.titre.slice(0, 52) });
        }
      }
      parSource.set(source, ps);
      parMarche.set(marche, pm);
    }
    curseur = lot[lot.length - 1].id;
    if (LIMITE && vues >= LIMITE) break;
  }

  console.log(`  ${vues.toLocaleString('fr-FR')} offres actives examinées sur ${total.toLocaleString('fr-FR')}`);
  console.log(`  inchangées ${inchangees.toLocaleString('fr-FR')} (${pct(inchangees, vues)}) · changées ${changees.toLocaleString('fr-FR')} (${pct(changees, vues)})`);
  console.log(`  ∅ → langue : ${depuisNull.toLocaleString('fr-FR')}   ·   langue → ∅ : ${versNull.toLocaleString('fr-FR')}\n`);

  console.log('  PROVENANCE DE LA VALEUR RETENUE');
  for (const [p, n] of [...parProvenance.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`    ${p.padEnd(26)} ${String(n).padStart(7)}  ${pct(n, vues)}`);
  }

  console.log('\n  MATRICE ANCIENNE → NOUVELLE (20 premières)');
  for (const [k, n] of [...matrice.entries()].sort((a, b) => b[1] - a[1]).slice(0, 20)) {
    console.log(`    ${k.padEnd(16)} ${String(n).padStart(7)}`);
  }

  console.log('\n  PAR MARCHÉ (les 16, plus les pays servis)');
  console.log('    marché   offres   changées      ∅→lang   lang→∅');
  for (const [m, e] of [...parMarche.entries()].sort((a, b) => b[1].total - a[1].total).slice(0, 20)) {
    console.log(`    ${m.padEnd(8)} ${String(e.total).padStart(6)} ${pct(e.change, e.total).padStart(10)} ${String(e.depuisNull).padStart(11)} ${String(e.versNull).padStart(8)}`);
  }

  console.log('\n  SOURCES LES PLUS TOUCHÉES (≥ 50 offres)');
  for (const [s, e] of [...parSource.entries()].filter(([, e]) => e.total >= 50)
    .sort((a, b) => b[1].change / b[1].total - a[1].change / a[1].total).slice(0, 15)) {
    console.log(`    ${s.padEnd(28)} ${String(e.total).padStart(6)} offres · ${pct(e.change, e.total)} changées`);
  }

  console.log('\n  ÉCHANTILLON DE CONFLITS — à lire à l’œil, une valeur changée n’est pas une valeur juste');
  for (const c of conflits.slice(0, 15)) {
    console.log(`    [${c.pays}] ${c.source.padEnd(20)} ${c.ancienne} → ${c.nouvelle} (conf. ${c.confiance})  ${c.titre}`);
  }

  console.log('\n  ' + '─'.repeat(88));
  console.log('  Les COMPTES sont une preuve, recomptable en rejouant cette sonde.');
  console.log('  Le VERDICT du détecteur est une heuristique : un changement n’est pas une correction prouvée.');
  console.log('  Les ∅ restants sont une incertitude ASSUMÉE : aucune langue n’est déduite du pays.');
  console.log('  LECTURE SEULE — aucune donnée modifiée.\n');
} finally {
  await db.$disconnect();
}
