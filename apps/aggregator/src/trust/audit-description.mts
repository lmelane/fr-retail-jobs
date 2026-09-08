/**
 * AUDIT DE PRÉCISION de la preuve DESCRIPTION — lecture seule, sans réseau.
 *
 * La description pèse 70 % des décisions `workplaceType` : c'est le principal
 * risque d'injecter des faux positifs en masse. Cet audit répond à une seule
 * question, exigée par Loïc avant migration : **quelle règle a matché, sur quel
 * volume, et un humain peut-il juger sur pièces ?**
 *
 *   DATABASE_URL=<prod> npx tsx src/trust/audit-description.mts
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const BATCH = 5000;

/**
 * Les règles candidates, nommées, pour que le rapport dise CE QUI a décidé.
 *
 * Deux familles :
 *  - ASSERTION : une phrase qui parle de l'organisation du travail DE CETTE
 *    OFFRE (« this role is fully remote », « télétravail 2 jours par semaine »).
 *  - MENTION : le mot apparaît, sans qu'on sache s'il qualifie le poste
 *    (« hybrid retail strategy », « manage remote teams »).
 *
 * Seules les ASSERTIONS ont vocation à écrire. Multilingue par construction :
 * les libellés des sources sont mesurés, pas supposés.
 */
type Rule = { name: string; family: 'ASSERTION' | 'MENTION'; type: string; re: RegExp };

const RULES: Rule[] = [
  // — ASSERTIONS : le sujet est LE POSTE —
  {
    name: 'poste-remote-explicite',
    family: 'ASSERTION',
    type: 'REMOTE',
    re: /\b(?:this (?:role|position|job)|the role|le poste|ce poste|cette offre)\b[^.]{0,40}\b(?:is|est|en)\b[^.]{0,20}\b(?:fully |100% |full |totalement |entièrement )?(?:remote|télétravail|teletravail|home[- ]based)\b/i,
  },
  {
    name: 'remote-qualifie',
    family: 'ASSERTION',
    type: 'REMOTE',
    re: /\b(?:fully|100%|full)[- ]remote\b|\bremote[- ](?:position|role|job|opportunity)\b|\btélétravail (?:total|complet|à 100)\b|\b100\s?% (?:télétravail|remote)\b/i,
  },
  {
    name: 'poste-hybride-explicite',
    family: 'ASSERTION',
    type: 'HYBRID',
    re: /\b(?:this (?:role|position|job)|the role|le poste|ce poste)\b[^.]{0,40}\b(?:is|est)\b[^.]{0,20}\bhybri[dq]/i,
  },
  {
    name: 'hybride-qualifie',
    family: 'ASSERTION',
    type: 'HYBRID',
    re: /\bhybrid (?:role|position|model|schedule|working|work model|arrangement)\b|\b(?:modèle|mode|organisation|rythme) hybride\b|\btravail hybride\b/i,
  },
  {
    name: 'rythme-jours-bureau',
    family: 'ASSERTION',
    type: 'HYBRID',
    re: /\b[1-4]\s?(?:days?|jours?)\b[^.]{0,30}\b(?:per week |a week |par semaine )?(?:in|at|au|de|dans)?[^.]{0,12}\b(?:office|bureau|site|onsite|on-site)\b|\btélétravail\b[^.]{0,20}\b[1-4]\s?jours?\b/i,
  },
  {
    name: 'poste-sur-site-explicite',
    family: 'ASSERTION',
    type: 'ONSITE',
    re: /\b(?:this is an?|this (?:role|position) is)\b[^.]{0,20}\bon[- ]?site\b|\bon[- ]?site (?:position|role|only)\b|\bposte (?:en|sur) (?:présentiel|site)\b|\b(?:aucun|pas de) télétravail\b|\bno remote work\b/i,
  },
  // — MENTIONS : le mot est là, le sujet n'est pas le poste —
  {
    name: 'mention-remote-nue',
    family: 'MENTION',
    type: 'REMOTE',
    re: /\bremote\b/i,
  },
  {
    name: 'mention-hybride-nue',
    family: 'MENTION',
    type: 'HYBRID',
    re: /\bhybri[dq]/i,
  },
  {
    name: 'mention-teletravail-nue',
    family: 'MENTION',
    type: 'REMOTE',
    re: /\bt[ée]l[ée]travail\b/i,
  },
];

async function main(): Promise<void> {
  const byRule = new Map<string, number>();
  const samplesByRule = new Map<string, string[]>();
  /** Une offre dont AUCUNE assertion ne matche mais où une mention traîne. */
  let mentionOnly = 0;
  const mentionSamples: string[] = [];
  let assertionTotal = 0;
  let scanned = 0;
  let cursor: string | undefined;

  for (;;) {
    const rows = await prisma.job.findMany({
      where: { isActive: true, description: { not: null } },
      select: { id: true, title: true, description: true },
      orderBy: { id: 'asc' }, take: BATCH,
      ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
    });
    if (rows.length === 0) break;
    cursor = rows[rows.length - 1].id;

    for (const row of rows) {
      scanned++;
      const text = row.description ?? '';

      const assertions = RULES.filter((r) => r.family === 'ASSERTION' && r.re.test(text));
      const mentions = RULES.filter((r) => r.family === 'MENTION' && r.re.test(text));

      for (const rule of assertions) {
        byRule.set(rule.name, (byRule.get(rule.name) ?? 0) + 1);
        const bucket = samplesByRule.get(rule.name) ?? [];
        if (bucket.length < 4) {
          const m = text.match(rule.re);
          const around = m?.index !== undefined ? text.slice(Math.max(0, m.index - 40), m.index + 90) : '';
          bucket.push(`« ${around.replace(/\s+/g, ' ').trim()} »  ← ${row.title.slice(0, 34)}`);
          samplesByRule.set(rule.name, bucket);
        }
      }
      if (assertions.length > 0) assertionTotal++;

      if (assertions.length === 0 && mentions.length > 0) {
        mentionOnly++;
        if (mentionSamples.length < 10) {
          const rule = mentions[0];
          const m = text.match(rule.re);
          const around = m?.index !== undefined ? text.slice(Math.max(0, m.index - 50), m.index + 80) : '';
          mentionSamples.push(`« ${around.replace(/\s+/g, ' ').trim()} »`);
        }
      }
    }
    process.stderr.write(`  … ${scanned}\r`);
  }

  console.log(`\n\n=== AUDIT DE PRÉCISION — preuve DESCRIPTION (${scanned} offres avec texte) ===\n`);
  console.log(`Règles d'ASSERTION : ${RULES.filter((r) => r.family === 'ASSERTION').length}\n`);
  for (const rule of RULES.filter((r) => r.family === 'ASSERTION')) {
    const n = byRule.get(rule.name) ?? 0;
    console.log(`── ${rule.name}  (${rule.type})  →  ${n} offres`);
    for (const s of samplesByRule.get(rule.name) ?? []) console.log(`     ${s}`);
    console.log();
  }

  console.log(`Offres décidées par au moins une ASSERTION : ${assertionTotal}`);
  console.log(`\nOffres où SEULE une mention nue apparaît (REFUSÉES) : ${mentionOnly}`);
  console.log(`Ce sont les faux positifs que la v1 précédente aurait écrits :`);
  for (const s of mentionSamples) console.log(`  · ${s}`);

  await prisma.$disconnect();
}

main().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
