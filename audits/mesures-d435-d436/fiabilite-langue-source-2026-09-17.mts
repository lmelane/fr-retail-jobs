/**
 * LA LANGUE DÉCLARÉE PAR UNE SOURCE EST-ELLE FIABLE ? — mesure par source, lecture seule.
 *
 * ── LA QUESTION, ET POURQUOI ELLE N'EST PAS RHÉTORIQUE ────────────────────────────────────────
 *
 * `publication/content.ts:51` applique `candidate.language ?? detectLanguage(...)` : la
 * déclaration de la source PRIME, toujours, sans condition. C'est un pari — et un pari qu'on n'a
 * jamais vérifié.
 *
 * Une source peut déclarer la locale de son PORTAIL plutôt que celle de l'annonce (un tenant
 * Workday configuré en `fr-FR` sert des annonces anglaises), ou recopier la locale de la requête
 * qu'on lui a envoyée. Dans les deux cas la valeur est syntaxiquement valide et sémantiquement
 * fausse, et rien ne la contredit puisqu'elle court-circuite la détection.
 *
 * Cette sonde compare, source par source, ce que la source DÉCLARE et ce que le TEXTE dit. Elle
 * ne tranche pas : elle rend un taux d'accord, qui permettra de décider quelles sources méritent
 * la priorité et lesquelles doivent repasser par la détection.
 *
 * ── CE QU'ELLE NE PEUT PAS FAIRE, ET IL FAUT LE SAVOIR EN LISANT SES CHIFFRES ─────────────────
 *
 * Le détecteur actuel ne couvre que SEPT langues latines (`lib/language.ts`) et découpe sur
 * `[^a-zà-ÿœ]`. Le japonais, le coréen et le chinois ne produisent aucun jeton : ils ressortent
 * TOUJOURS indéterminés. Une source qui déclare `ja` ne peut donc être ni confirmée ni infirmée
 * ici — elle compte en « indéterminé », jamais en « désaccord ».
 *
 * Autrement dit : cette sonde mesure la fiabilité des déclarations SUR LE PÉRIMÈTRE LATIN. C'est
 * une borne inférieure de ce qu'il faudra savoir, pas la réponse complète.
 *
 * ── USAGE ─────────────────────────────────────────────────────────────────────────────────────
 *
 *   python3 apps/aggregator/scripts/ops/db.py readonly npx tsx \
 *     audits/mesures-d435-d436/fiabilite-langue-source-2026-09-17.mjs [limite]
 */
import { PrismaClient } from '@prisma/client';
import { detectLanguage } from '../../apps/aggregator/src/lib/language.js';

const LIMITE = Number(process.argv[2] ?? 30000);
const db = new PrismaClient();

try {
  const lignes = await db.$queryRawUnsafe(`
    SELECT s."sourceKey" AS source, j.language AS stockee, j.title, j.description,
           j."countryCode" AS pays
      FROM "Job" j
      JOIN "JobSource" s ON s."jobId" = j.id AND s."isActive"
     WHERE j."isActive" AND j.language IS NOT NULL
     ORDER BY j.id
     LIMIT ${LIMITE}`);

  /** Par source : accords, désaccords, indéterminés, et le détail des désaccords. */
  const parSource = new Map();
  for (const l of lignes) {
    const detectee = detectLanguage(l.description ?? l.title);
    const e = parSource.get(l.source) ?? { total: 0, accord: 0, desaccord: 0, indetermine: 0, cas: new Map() };
    e.total++;
    if (detectee === undefined) e.indetermine++;
    else if (detectee === l.stockee) e.accord++;
    else {
      e.desaccord++;
      const cle = `${l.stockee}→${detectee}`;
      e.cas.set(cle, (e.cas.get(cle) ?? 0) + 1);
    }
    parSource.set(l.source, e);
  }

  const pct = (n, d) => (d ? `${((100 * n) / d).toFixed(1)} %` : '—');
  const classables = (e) => e.accord + e.desaccord;

  console.log(`\nFIABILITÉ DE LA LANGUE DÉCLARÉE — ${lignes.length.toLocaleString('fr-FR')} offres, mesure du ${new Date().toISOString().slice(0, 10)}\n`);
  console.log('  Le taux d\'accord porte sur les seules offres CLASSABLES par le détecteur latin.');
  console.log('  Une source servant du japonais ou du coréen ressort « indéterminée », pas « fausse ».\n');
  console.log('  source                        offres   classables    accord   désaccord   principales divergences');
  console.log('  ' + '─'.repeat(104));

  const ordonnees = [...parSource.entries()]
    .filter(([, e]) => classables(e) >= 20)
    .sort((a, b) => classables(a[1]) / (a[1].accord || 1) - classables(b[1]) / (b[1].accord || 1));

  for (const [source, e] of ordonnees) {
    const c = classables(e);
    const top = [...e.cas.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3)
      .map(([k, n]) => `${k} ${n}`).join(' · ');
    console.log(`  ${source.padEnd(28)} ${String(e.total).padStart(6)} ${String(c).padStart(12)}`
      + `  ${pct(e.accord, c).padStart(8)}  ${pct(e.desaccord, c).padStart(9)}   ${top}`);
  }

  const petites = [...parSource.entries()].filter(([, e]) => classables(e) < 20);
  if (petites.length) console.log(`\n  (${petites.length} source(s) sous 20 offres classables : non listées, l'échantillon ne dirait rien)`);

  const tot = [...parSource.values()].reduce((a, e) => ({
    total: a.total + e.total, accord: a.accord + e.accord,
    desaccord: a.desaccord + e.desaccord, indetermine: a.indetermine + e.indetermine,
  }), { total: 0, accord: 0, desaccord: 0, indetermine: 0 });

  console.log('\n  ' + '─'.repeat(104));
  console.log(`  ENSEMBLE : ${tot.total.toLocaleString('fr-FR')} offres · classables ${(tot.accord + tot.desaccord).toLocaleString('fr-FR')}`
    + ` · accord ${pct(tot.accord, tot.accord + tot.desaccord)} · désaccord ${pct(tot.desaccord, tot.accord + tot.desaccord)}`
    + ` · indéterminées ${tot.indetermine.toLocaleString('fr-FR')}`);
  console.log('\n  Un désaccord ne dit pas QUI a tort : le détecteur peut se tromper autant que la source.');
  console.log('  Il dit où la déclaration n\'est pas corroborée par le texte, et mérite un examen.');
  console.log('  LECTURE SEULE — aucune donnée modifiée.\n');
} finally {
  await db.$disconnect();
}
