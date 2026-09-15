/**
 * LE VOCABULAIRE NATIF DE CHAQUE MARCHÉ — ce que les sources publient vraiment.
 *
 * LECTURE SEULE : uniquement des `SELECT`. Aucune écriture.
 *
 * ── CE QUE CE SCRIPT SERT À DÉCIDER ───────────────────────────────────────
 *
 * Le CEO, le 15/09/2026 : « canoniser en fonction du PAYS, mais toujours sur
 * la même logique de filtres — sauf que le nom et le type des champs sont
 * différents. En France "Type de contrat", ailleurs "Job type", donc
 * forcément les valeurs ne sont pas les mêmes. »
 *
 * Un relevé des 20 marchés d'Indeed le confirme côté interface :
 *
 *     FR  « Type de contrat »      GB/US/AU/IE  « Job type »
 *     DE  « Anstellungsart »       IT           « Tipo di contratto »
 *     ES  « Tipo de empleo »       NL           « Dienstverband »
 *     CA-fr « Type de poste »      PT           « Tipo de Oferta »
 *
 * Deux enseignements de ce relevé, vérifiés ici sur nos données :
 *   - le Canada francophone n'utilise PAS le libellé français de France : la
 *     langue ne détermine pas le marché ;
 *   - la Suisse expose « Type de contrat » ET « Temps de travail » comme DEUX
 *     filtres distincts — et nos chiffres le confirment (contrat 17,2 %,
 *     temps 49,1 %).
 *
 * ── CE QUE CE SCRIPT MESURE, ET CE QU'IL NE FAIT PAS ──────────────────────
 *
 * Il relève les VALEURS RÉELLEMENT PUBLIÉES par marché, dans les champs
 * structurés et dans les descriptions. Il ne décide d'aucun libellé et ne
 * propose aucune correspondance : un inventaire menu par menu resterait
 * nécessaire pour cela, et c'est un arbitrage produit.
 *
 * Il ne dit pas non plus qu'une valeur est JUSTE : une source française
 * étiquette « CDI » des postes saisonniers américains (196 offres mesurées).
 * Présence ≠ exactitude.
 *
 *   DB_URL=… node audits/mesures-d435-d436/vocabulaire-natif-par-pays-2026-09-15.mjs
 */
import { PrismaClient } from '@prisma/client';

const url = process.env.DB_URL;
if (!url) {
  console.error('DB_URL manquante.');
  process.exit(1);
}
const prisma = new PrismaClient({ datasources: { db: { url } } });
const lire = (sql) => prisma.$queryRawUnsafe(sql);
const n = (v) => Number(v ?? 0);
const fr = (v) => n(v).toLocaleString('fr-FR');

/** Les marchés à instruire : ceux qui pèsent assez pour qu'un taux soit lisible. */
const MARCHES = ['US', 'FR', 'GB', 'CA', 'DE', 'IT', 'ES', 'NL', 'AU', 'CH', 'CN', 'BE', 'JP', 'PT'];

/**
 * Le vocabulaire cherché dans les DESCRIPTIONS, par famille de dimension.
 *
 * Chaque terme est écrit dans la langue où il se dit — c'est tout l'objet de
 * la mesure. On cherche « Ausbildung » en Allemagne et « seasonal » en
 * Australie, jamais l'inverse.
 *
 * `ILIKE` plutôt qu'une expression régulière : une première version de cette
 * mesure a rendu « seasonal : 0 » sur 36 929 offres américaines à cause d'un
 * double échappement, alors que le vrai chiffre est 4 080. Un motif simple
 * qu'on peut relire est préférable à un motif savant qu'on lit mal.
 */
const VOCABULAIRE = {
  'durée / statut': [
    'CDI', 'CDD', 'permanent', 'fixed-term', 'unbefristet', 'befristet',
    'tempo indeterminato', 'tempo determinato', 'contrato indefinido', 'contrato temporal',
    'vast contract', 'tijdelijk', 'temporary', 'contract', 'freelance', 'self-employed',
  ],
  'temps de travail': [
    'temps plein', 'temps partiel', 'full-time', 'part-time', 'vollzeit', 'teilzeit',
    'tempo pieno', 'part time', 'jornada completa', 'media jornada', 'voltijd', 'deeltijd',
  ],
  'rythme / saisonnalité': [
    'seasonal', 'saisonnier', 'casual', 'per diem', 'on-call', 'zero hour',
    'non-guaranteed hours', 'shift', 'weekend',
  ],
  'programme / public': [
    'stage', 'alternance', 'apprentissage', 'internship', 'intern', 'apprenticeship',
    'graduate programme', 'praktikum', 'ausbildung', 'duales studium', 'tirocinio',
    'prácticas', 'werkstudent', 'traineeship', 'V.I.E',
  ],
};

const [{ total }] = await lire(`SELECT COUNT(*)::int AS total FROM "Job" WHERE "isActive"`);
console.log(`\n  VOCABULAIRE NATIF — mesuré sur ${fr(total)} offres actives\n`);

for (const marche of MARCHES) {
  const [{ offres }] = await lire(`
    SELECT COUNT(*)::int AS offres FROM "Job"
     WHERE "isActive" AND "countryCode" = '${marche}' AND description IS NOT NULL`);
  if (n(offres) < 400) continue;

  console.log(`\n  ══ ${marche} — ${fr(offres)} offres avec description ══`);

  for (const [famille, termes] of Object.entries(VOCABULAIRE)) {
    const trouves = [];
    for (const terme of termes) {
      /* Le terme est écrit en clair dans le script : pas d'injection possible,
         mais on double les apostrophes par principe (« prácticas », « V.I.E »). */
      const motif = terme.replace(/'/g, "''");
      const [r] = await lire(`
        SELECT COUNT(*)::int AS nb FROM "Job"
         WHERE "isActive" AND "countryCode" = '${marche}'
           AND description ILIKE '%${motif}%'`);
      const taux = (n(r.nb) / n(offres)) * 100;
      /* Sous 2 %, le terme est anecdotique sur ce marché : il ne mérite pas
         une valeur de facette, et l'afficher encombrerait le candidat. */
      if (taux >= 2) trouves.push(`${terme} ${taux.toFixed(0)}%`);
    }
    console.log(`     ${famille.padEnd(22)} ${trouves.length ? trouves.join(' · ') : '—'}`);
  }
}

/* ── LES VALEURS STRUCTURÉES, QUI PRIMENT SUR LE TEXTE ─────────────────── */
console.log('\n\n  ══ CE QUE LES CHAMPS STRUCTURÉS PUBLIENT, PAR MARCHÉ ══');
console.log('  Un champ dédié prime toujours sur une occurrence dans le texte.\n');

for (const marche of ['US', 'FR', 'GB', 'DE', 'AU', 'CH']) {
  const vals = await lire(`
    SELECT j."rawContract" AS v, COUNT(*)::int AS nb
      FROM "Job" j
     WHERE j."isActive" AND j."countryCode" = '${marche}' AND j."rawContract" IS NOT NULL
     GROUP BY 1 ORDER BY 2 DESC LIMIT 8`);
  if (!vals.length) { console.log(`  ${marche} — aucun champ structuré conservé.`); continue; }
  console.log(`  ${marche} : ` + vals.map((v) => `« ${v.v} » ${fr(v.nb)}`).join(' · '));
}

/* ── LA CONTAMINATION : un vocabulaire importé d'un autre marché ───────── */
console.log('\n\n  ══ VOCABULAIRE IMPORTÉ — un concept d’un pays posé sur un autre ══\n');
const importe = await lire(`
  SELECT j."countryCode" AS pays, j."rawContract" AS v, COUNT(*)::int AS nb
    FROM "Job" j
   WHERE j."isActive" AND j."countryCode" NOT IN ('FR', 'BE', 'CH', 'LU', 'MC')
     AND (j."rawContract" ILIKE 'CDI%' OR j."rawContract" ILIKE 'CDD%' OR j."rawContract" ILIKE '%alternance%')
   GROUP BY 1, 2 ORDER BY 3 DESC LIMIT 10`);
if (!importe.length) {
  console.log('  Aucun vocabulaire français hors des marchés francophones.');
} else {
  console.log('  pays   valeur française        offres');
  for (const i of importe) {
    console.log('  ' + String(i.pays).padEnd(7) + String(i.v).slice(0, 22).padEnd(24) + fr(i.nb).padStart(7));
  }
  console.log('\n  Ces libellés viennent de la SOURCE (maisons françaises appliquant');
  console.log('  leur convention RH à l’étranger), pas de notre normalisation.');
}

console.log('\n  ' + '─'.repeat(70));
console.log('  LECTURE SEULE — aucune donnée modifiée.\n');

await prisma.$disconnect();
