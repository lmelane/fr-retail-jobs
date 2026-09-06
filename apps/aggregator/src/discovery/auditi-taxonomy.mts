import { PrismaClient } from '@prisma/client';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { classifyJob, classifyFunction, comparableTitle } from '../normalize/taxonomy.js';
import { skillKind } from '../normalize/skills.js';

/**
 * Audit I — Axe 3 (taxonomie). LECTURE SEULE : aucune écriture en base.
 * Usage : DATABASE_URL=… npx tsx src/discovery/auditi-taxonomy.mts <label> <outDir>
 *
 * - échantillon déterministe de 300 offres actives (tri md5(id||sel)), classées
 *   par `classifyJob` (le code réel), écrites en TSV pour jugement manuel ;
 * - top 50 des titres actifs non classés (toute la base) ;
 * - 20 premières offres IA (calcul + colonne stockée) avec l'extrait déclencheur ;
 * - fenêtres de contexte des langues détectées dans l'échantillon.
 */
const label = process.argv[2] ?? 'local';
const outDir = process.argv[3] ?? '.';
mkdirSync(outDir, { recursive: true });
const SAMPLE = 300;
const SALT = 'auditi-axe3';

const prisma = new PrismaClient();

type Row = {
  id: string;
  title: string;
  department: string | null;
  contract: string | null;
  description: string | null;
  jobFunction: string | null;
  seniority: string | null;
  isRetail: boolean | null;
  isAiRelated: boolean;
  skills: string[];
  taxonomyVersion: number;
  companyName: string;
  sourceKey: string | null;
};

const SELECT = `SELECT j.id, j.title, j.department, j.contract, j.description, j."jobFunction", j.seniority, j."isRetail", j."isAiRelated", j.skills, j."taxonomyVersion", c.name AS "companyName",
  (SELECT s."sourceKey" FROM "JobSource" s WHERE s."jobId" = j.id ORDER BY s."isActive" DESC, s."sourceKey" LIMIT 1) AS "sourceKey"
  FROM "Job" j JOIN "Company" c ON c.id = j."companyId"`;

const sample = await prisma.$queryRawUnsafe<Row[]>(
  `${SELECT} WHERE j."isActive" ORDER BY md5(j.id || '${SALT}') LIMIT ${SAMPLE}`,
);

const clean = (s: string | null | undefined) => (s ?? '').replace(/[\t\n\r]+/g, ' ').trim();

// ----- AI : reproduit la logique de isAiRelated pour exposer l'extrait déclencheur -----
const AI_ACRONYM_RE = /(?<!['’])\b(?:AI|IA|GENAI|LLMS?|NLP)\b(?![-']?\w)/;
const AI_PHRASE_RE = /artificial intelligence|intelligence artificielle|intelligenza artificiale|inteligencia artificial|k[üu]nstliche intelligenz|machine learning|apprentissage (automatique|machine)|deep learning|generative ai|gen ?ai\b|ia g[ée]n[ée]rative|large language model|computer vision|data scien|prompt engineer|\bcopilot\b|chatgpt|openai|neural network|r[ée]seaux? de neurones/i;
const PROCESS_SENTENCE_RE = /interview|entretien|recruit|recrut|hiring (process|decision|team|manager)|selection process|processus de (s[ée]lection|recrutement)|candidat|applicant|application(s)? (process|form|will|are|is)|assessment|fraud|scam|privacy|data protection|personal data|donn[ée]es personnelles|equal (opportunit|employment)|discriminat|accommodation|inteligencia artificial.{0,60}(entrevista|proceso)|refrain|abstenga|prohibit|not permitted|is not used|n'est pas utilis|sans utiliser|ne pas utiliser|disclos|consent|GDPR|RGPD|Bewerbung|Auswahl/i;

function aiTriggers(title: string, description: string | null): string[] {
  const body = (description ?? '')
    .slice(0, 30_000)
    .split(/(?<=[.!?])\s+|\n+|\s[•·▪●-]\s/)
    .filter((sentence) => !PROCESS_SENTENCE_RE.test(sentence))
    .join('\n');
  const text = `${title}\n${body}`;
  const out: string[] = [];
  for (const re of [AI_PHRASE_RE, AI_ACRONYM_RE]) {
    const g = new RegExp(re.source, re.flags.includes('g') ? re.flags : `${re.flags}g`);
    let m: RegExpExecArray | null;
    while ((m = g.exec(text)) !== null && out.length < 4) {
      out.push(clean(text.slice(Math.max(0, m.index - 90), m.index + m[0].length + 90)));
    }
  }
  return out;
}

// ----- Langues : reproduit languageMentioned pour exposer la fenêtre -----
const LANGUAGES: ReadonlyArray<[string, RegExp]> = [
  ['Anglais', /\b(english|anglais|inglese|ingl[eé]s|englisch)\b/i],
  ['Français', /\b(french|fran[cç]ais|francese|franc[eé]s|franz[öo]sisch)\b/i],
  ['Mandarin', /\b(mandarin|chinese|chinois|cinese|chino|chinesisch|putonghua)\b|中文|普通话/i],
  ['Cantonais', /\b(cantonese|cantonais)\b|粵語|广东话/i],
  ['Arabe', /\b(arabic|arabe|arabo|[aá]rabe|arabisch)\b/i],
  ['Japonais', /\b(japanese|japonais|giapponese|japon[eé]s|japanisch)\b|日本語/i],
  ['Coréen', /\b(korean|cor[eé]en|coreano|koreanisch)\b|한국어/i],
  ['Italien', /\b(italian|italien|italiano|italienisch)\b/i],
  ['Espagnol', /\b(spanish|espagnol|spagnolo|espa[nñ]ol|spanisch|castellano)\b/i],
  ['Allemand', /\b(german|allemand|tedesco|alem[aá]n|deutsch)\b/i],
  ['Portugais', /\b(portuguese|portugais|portoghese|portugu[eê]s)\b/i],
  ['Russe', /\b(russian|russe|russo|ruso|russisch)\b/i],
  ['Néerlandais', /\b(dutch|n[eé]erlandais|olandese|nederlands|niederl[äa]ndisch)\b/i],
  ['Hindi', /\bhindi\b/i],
  ['Thaï', /\b(thai|tha[iï])\b/i],
  ['Turc', /\b(turkish|turc|turco|t[üu]rkisch)\b/i],
  ['Hébreu', /\b(hebrew|h[eé]breu)\b/i],
  ['Vietnamien', /\b(vietnamese|vietnamien)\b/i],
  ['Indonésien', /\b(indonesian|bahasa|indon[eé]sien)\b/i],
];
const LANGUAGE_CUE_RE = /fluen|proficien|speak|spoken|langu|langue|bilingu|native|natif|courant|ma[iî]tris|niveau|level|parl|written|oral|\bB2\b|\bC1\b|\bC2\b|conversational|advanced|intermediate|business level|mother tongue|idioma|lingua|sprach|kenntnisse|required|requis|plus\b|appreciated|appr[eé]ci|mandatory|obligatoire|indispensable|would be|serait un|is a must|is required|est requis|exig/i;

function languageWindows(text: string, name: string): string[] {
  const def = LANGUAGES.find(([n]) => n === name);
  if (!def) return [];
  const re = new RegExp(def[1].source, `${def[1].flags}g`);
  const out: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null && out.length < 2) {
    const start = Math.max(0, m.index - 70);
    const end = Math.min(text.length, m.index + m[0].length + 70);
    const w = text.slice(start, end);
    const cue = w.match(LANGUAGE_CUE_RE);
    if (cue) out.push(`[cue=${cue[0]}] ${clean(w)}`);
  }
  return out;
}

// ----- 1. Échantillon classé -----
const header = ['n', 'id', 'source', 'company', 'title', 'department', 'contract', 'fn', 'seniority', 'retail', 'ai', 'skills', 'stored_fn', 'stored_sen', 'stored_ai', 'stored_ver', 'desc_head'].join('\t');
const lines: string[] = [header];
const sampleJson: Array<Record<string, unknown>> = [];
sample.forEach((r, i) => {
  const c = classifyJob({ title: r.title, department: r.department, description: r.description, contract: r.contract });
  lines.push([
    i + 1, r.id, r.sourceKey ?? '', clean(r.companyName), clean(r.title), clean(r.department), clean(r.contract),
    c.jobFunction ?? 'NULL', c.seniority, c.isRetail === null ? 'NULL' : String(c.isRetail), String(c.isAiRelated),
    c.skills.join('|'), r.jobFunction ?? '', r.seniority ?? '', String(r.isAiRelated), String(r.taxonomyVersion),
    clean(r.description).slice(0, 160),
  ].join('\t'));
  sampleJson.push({ n: i + 1, id: r.id, title: r.title, department: r.department, contract: r.contract, computed: c, stored: { fn: r.jobFunction, sen: r.seniority, ai: r.isAiRelated, skills: r.skills, ver: r.taxonomyVersion } });
});
writeFileSync(join(outDir, `auditi-${label}-sample.tsv`), lines.join('\n') + '\n');
writeFileSync(join(outDir, `auditi-${label}-sample.json`), JSON.stringify(sampleJson, null, 1));

// ----- 2. Langues dans l'échantillon : chaque fenêtre qui a fait passer la langue -----
const langOut: string[] = [];
sample.forEach((r, i) => {
  const c = classifyJob({ title: r.title, department: r.department, description: r.description, contract: r.contract });
  const langs = c.skills.filter((s) => skillKind(s) === 'language');
  if (!langs.length) return;
  const text = `${r.title}\n${r.description ?? ''}`.slice(0, 40_000);
  langOut.push(`#${i + 1} ${r.id} | ${clean(r.companyName)} | ${clean(r.title)}`);
  for (const l of langs) for (const w of languageWindows(text, l)) langOut.push(`  ${l}: ${w}`);
});
writeFileSync(join(outDir, `auditi-${label}-lang.txt`), langOut.join('\n') + '\n');

// ----- 3. Non classés : toute la base active (titre + département seulement) -----
const all = await prisma.job.findMany({ where: { isActive: true }, select: { title: true, department: true, jobFunction: true, seniority: true, taxonomyVersion: true } });
const fnCount = new Map<string, number>();
const senCount = new Map<string, number>();
const un = new Map<string, { n: number; example: string }>();
let unclassified = 0;
let storedMismatch = 0;
let storedClassified = 0;
for (const r of all) {
  const fn = classifyFunction(r.title, r.department);
  fnCount.set(fn ?? 'NULL', (fnCount.get(fn ?? 'NULL') ?? 0) + 1);
  if (r.taxonomyVersion > 0) {
    storedClassified++;
    if ((r.jobFunction ?? null) !== fn) storedMismatch++;
  }
  if (!fn) {
    unclassified++;
    const key = comparableTitle(r.title)
      .replace(/\b(H F|F H|M F|F M|M W D|W M D|F M D|M F D|X F M|CDI|CDD|TEMPS (PLEIN|PARTIEL)|FULL[- ]TIME|PART[- ]TIME|\d+ ?H|\d+)\b/g, '')
      .replace(/\s+/g, ' ')
      .replace(/^[- ]+|[- ]+$/g, '')
      .trim();
    const cur = un.get(key);
    if (cur) cur.n++;
    else un.set(key, { n: 1, example: r.title });
  }
}
const stats: string[] = [];
stats.push(`label=${label} active=${all.length} unclassified=${unclassified} (${((100 * unclassified) / all.length).toFixed(1)}%)`);
stats.push(`stored: taxonomyVersion>0 = ${storedClassified}; stored jobFunction != recomputed = ${storedMismatch}`);
stats.push('--- function distribution (recomputed)');
for (const [k, v] of [...fnCount].sort((a, b) => b[1] - a[1])) stats.push(`${v}\t${k}`);
stats.push('--- top 50 unclassified titles (normalized, count, example)');
for (const [k, v] of [...un].sort((a, b) => b[1].n - a[1].n).slice(0, 50)) stats.push(`${v.n}\t${k}\t${v.example}`);
writeFileSync(join(outDir, `auditi-${label}-unclassified.txt`), stats.join('\n') + '\n');

// ----- 4. IA : 20 premières offres flaggées (stockées si la base en a, sinon recalculées) -----
const storedAi = await prisma.$queryRawUnsafe<Row[]>(`${SELECT} WHERE j."isActive" AND j."isAiRelated" ORDER BY j.id LIMIT 20`);
const aiRows: Row[] = storedAi.length
  ? storedAi
  : (await prisma.$queryRawUnsafe<Row[]>(`${SELECT} WHERE j."isActive" ORDER BY j.id`)).filter((r) => classifyJob({ title: r.title, description: r.description }).isAiRelated).slice(0, 20);
const aiOut: string[] = [`mode=${storedAi.length ? 'stored isAiRelated=true, 20 premières par id' : 'recalculées sur toute la base (colonne vide)'}`];
for (const r of aiRows) {
  const computed = classifyJob({ title: r.title, description: r.description }).isAiRelated;
  aiOut.push(`\n${r.id} | ${clean(r.companyName)} | ${clean(r.title)} | fn=${classifyFunction(r.title, r.department) ?? 'NULL'} | stored=${r.isAiRelated} computed=${computed}`);
  for (const t of aiTriggers(r.title, r.description)) aiOut.push(`   >> ${t}`);
}
// Second lot : 60 flaggées au hasard (déterministe) pour un taux, pas seulement les 20 premières.
const randomAi = await prisma.$queryRawUnsafe<Row[]>(`${SELECT} WHERE j."isActive" AND j."isAiRelated" ORDER BY md5(j.id || '${SALT}') LIMIT 60`);
if (randomAi.length) {
  aiOut.push('\n=== 60 flaggées au hasard ===');
  for (const r of randomAi) {
    aiOut.push(`\n${r.id} | ${clean(r.companyName)} | ${clean(r.title)} | fn=${classifyFunction(r.title, r.department) ?? 'NULL'}`);
    for (const t of aiTriggers(r.title, r.description).slice(0, 2)) aiOut.push(`   >> ${t}`);
  }
}
writeFileSync(join(outDir, `auditi-${label}-ai.txt`), aiOut.join('\n') + '\n');

console.log(stats.slice(0, 2).join('\n'));
console.log(`sample=${sample.length} aiRows=${aiRows.length} randomAi=${randomAi.length} langRows=${langOut.filter((l) => l.startsWith('#')).length}`);
await prisma.$disconnect();
