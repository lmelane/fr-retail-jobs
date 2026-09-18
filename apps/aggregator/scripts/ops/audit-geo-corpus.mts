/**
 * STEP 2B — AUDIT GÉOGRAPHIQUE DU CORPUS PRIMAIRE. Lecture seule, AUCUNE correction.
 *
 *   python3 apps/aggregator/scripts/ops/db.py readonly npx tsx \
 *     apps/aggregator/scripts/ops/audit-geo-corpus.mts [--limite=N] [--sortie=<fichier.json>]
 *
 * ── CE QU'IL FAIT, ET CE QU'IL S'INTERDIT ──────────────────────────────────────────────────────
 *
 * Il ouvre CHAQUE extraction conservée — y compris celles des sources non publiantes, refusées ou
 * bloquées — et inventorie les signaux géographiques RÉELLEMENT présents dans la sortie
 * d'adaptateur. Il ne lit jamais `Job.countryCode` comme une preuve d'origine : ce champ est
 * précisément ce qu'on met à l'épreuve.
 *
 * Il n'écrit rien, ne géocode rien, ne construit aucune table de correspondance. Le livrable est
 * une mesure : ce que les sources donnent, ce que le pipeline en a déduit, où les deux divergent.
 *
 * ── LA CLASSIFICATION, ET SA LIMITE ASSUMÉE ────────────────────────────────────────────────────
 *
 *   CONFIRMÉ       un signal de la source établit le même pays que celui produit.
 *   CONTRADICTOIRE un signal de la source établit un AUTRE pays.
 *   AMBIGU         plusieurs pays restent possibles depuis les signaux disponibles.
 *   NON PROUVABLE  aucun signal suffisant dans les données conservées.
 *
 * « Non prouvable » n'est PAS une erreur : l'absence de preuve et la mauvaise attribution sont
 * deux choses différentes, et les compter ensemble masquerait les secondes.
 *
 * La reconnaissance de pays s'appuie ici sur un noyau volontairement ÉTROIT et explicite (codes
 * ISO-2 littéraux, quelques villes non ambiguës par marché). Ce n'est pas un moteur : c'est
 * l'instrument de mesure, et tout ce qu'il ne tranche pas est déclaré AMBIGU ou NON PROUVABLE
 * plutôt que deviné. Un instrument qui devine produirait exactement le défaut qu'on cherche.
 */
import { PrismaClient } from '@prisma/client';
import { writeFileSync } from 'node:fs';
import { readRawBlob } from '../../src/capture/store.js';

const limite = Number(process.argv.find((a) => a.startsWith('--limite='))?.slice(9) ?? 0);
const sortie = process.argv.find((a) => a.startsWith('--sortie='))?.slice(9);

const url = process.env.DB_URL ?? process.env.DATABASE_URL;
if (!url) { console.error('DB_URL (ou DATABASE_URL) manquante.'); process.exit(1); }
const prisma = new PrismaClient({ datasources: { db: { url } } });

/** Les clés que les adaptateurs emploient pour la géographie, telles qu'observées. */
const CLES_GEO = ['location', 'country', 'countryCode', 'city', 'region', 'state', 'province',
  'address', 'postalCode', 'zip', 'locations', 'workplaceType', 'remote', 'locationType'] as const;

/**
 * Villes dont le pays ne fait aucun doute dans le périmètre mode/luxe/beauté. Liste COURTE et
 * assumée : elle sert à détecter des contradictions flagrantes (Toronto ≠ US), pas à résoudre.
 * Toute ville absente d'ici laisse le verdict à AMBIGU — jamais à une déduction.
 */
const VILLES_SANS_DOUTE: Record<string, string> = {
  toronto: 'CA', montreal: 'CA', vancouver: 'CA', ottawa: 'CA', calgary: 'CA',
  paris: 'FR', lyon: 'FR', marseille: 'FR', bordeaux: 'FR', lille: 'FR', toulouse: 'FR',
  london: 'GB', manchester: 'GB', birmingham: 'GB', glasgow: 'GB', edinburgh: 'GB',
  berlin: 'DE', munich: 'DE', münchen: 'DE', hamburg: 'DE', frankfurt: 'DE', düsseldorf: 'DE',
  milano: 'IT', milan: 'IT', roma: 'IT', rome: 'IT', firenze: 'IT', florence: 'IT',
  madrid: 'ES', barcelona: 'ES', valencia: 'ES', sevilla: 'ES',
  amsterdam: 'NL', rotterdam: 'NL', 'den haag': 'NL', utrecht: 'NL',
  bruxelles: 'BE', brussels: 'BE', antwerp: 'BE', anvers: 'BE',
  zurich: 'CH', zürich: 'CH', geneva: 'CH', genève: 'CH', basel: 'CH',
  vienna: 'AT', wien: 'AT', stockholm: 'SE', copenhagen: 'DK', københavn: 'DK',
  oslo: 'NO', helsinki: 'FI', dublin: 'IE', lisboa: 'PT', lisbon: 'PT', porto: 'PT',
  warsaw: 'PL', warszawa: 'PL', prague: 'CZ', praha: 'CZ',
  'new york': 'US', 'los angeles': 'US', chicago: 'US', boston: 'US', seattle: 'US',
  'san francisco': 'US', atlanta: 'US', dallas: 'US', houston: 'US', miami: 'US',
  tokyo: 'JP', 'hong kong': 'HK', singapore: 'SG', seoul: 'KR', shanghai: 'CN',
  sydney: 'AU', melbourne: 'AU', dubai: 'AE', 'mexico city': 'MX', 'são paulo': 'BR',
};

/** Noms de pays écrits en toutes lettres, dans les langues réellement rencontrées. */
const NOMS_PAYS: Record<string, string> = {
  france: 'FR', allemagne: 'DE', germany: 'DE', deutschland: 'DE', italie: 'IT', italy: 'IT', italia: 'IT',
  espagne: 'ES', spain: 'ES', españa: 'ES', 'royaume-uni': 'GB', 'united kingdom': 'GB', uk: 'GB',
  'pays-bas': 'NL', netherlands: 'NL', nederland: 'NL', belgique: 'BE', belgium: 'BE', belgië: 'BE',
  suisse: 'CH', switzerland: 'CH', schweiz: 'CH', autriche: 'AT', austria: 'AT', österreich: 'AT',
  'united states': 'US', usa: 'US', 'états-unis': 'US', canada: 'CA', japan: 'JP', japon: 'JP',
  china: 'CN', chine: 'CN', australia: 'AU', australie: 'AU', portugal: 'PT', pologne: 'PL', poland: 'PL',
  suède: 'SE', sweden: 'SE', danemark: 'DK', denmark: 'DK', norvège: 'NO', norway: 'NO',
  irlande: 'IE', ireland: 'IE', 'république tchèque': 'CZ', czechia: 'CZ',
};

const ISO2 = /^[A-Z]{2}$/;
/**
 * Codes ISO-2 qui sont AUSSI des abréviations d'État américain ou de province canadienne. Un
 * `country: "AZ"` peut signifier Azerbaïdjan — ou l'Arizona mal rangé. On ne tranche pas : on marque.
 */
const CODES_AMBIGUS = new Set(['AL', 'AR', 'AZ', 'CA', 'CO', 'DE', 'FL', 'GA', 'IA', 'ID', 'IL',
  'IN', 'KS', 'KY', 'LA', 'MA', 'MD', 'ME', 'MI', 'MN', 'MO', 'MS', 'MT', 'NC', 'ND', 'NE', 'NH',
  'NJ', 'NM', 'NV', 'NY', 'OH', 'OK', 'OR', 'PA', 'SC', 'SD', 'TN', 'TX', 'UT', 'VA', 'VT', 'WA',
  'WI', 'WV', 'WY', 'AB', 'BC', 'MB', 'NB', 'NL', 'NS', 'ON', 'PE', 'QC', 'SK']);

const bas = (v: unknown) => String(v ?? '').toLowerCase().trim();

/** Pays établis par les signaux d'une extraction, avec le champ et la valeur qui les portent. */
function signaux(o: Record<string, unknown>) {
  const trouves: Array<{ champ: string; valeur: string; pays: string; force: 'STRUCTURE' | 'VILLE' | 'NOM' }> = [];
  const ambigus: Array<{ champ: string; valeur: string }> = [];
  const presents: string[] = [];

  for (const cle of CLES_GEO) {
    const v = o[cle];
    if (v === undefined || v === null || v === '') continue;
    presents.push(cle);
    const texte = typeof v === 'string' ? v : JSON.stringify(v);

    // 1. Un code ISO-2 littéral dans un champ de pays : le signal le plus fort — sauf s'il est ambigu.
    if ((cle === 'country' || cle === 'countryCode') && ISO2.test(texte.trim().toUpperCase())) {
      const code = texte.trim().toUpperCase();
      if (CODES_AMBIGUS.has(code)) ambigus.push({ champ: cle, valeur: code });
      else trouves.push({ champ: cle, valeur: code, pays: code, force: 'STRUCTURE' });
      continue;
    }
    // 2. Un nom de pays en toutes lettres, dans n'importe quel champ géographique.
    const t = bas(texte);
    for (const [nom, code] of Object.entries(NOMS_PAYS)) {
      if (t === nom || t.endsWith(`, ${nom}`) || t.includes(`, ${nom},`)) {
        trouves.push({ champ: cle, valeur: texte.slice(0, 80), pays: code, force: 'NOM' }); break;
      }
    }
    /*
     * 3. Une ville « sans doute »… qui n'en est une que si rien d'autre ne la contredit.
     *
     * Défaut mesuré sur le premier échantillon : « Paris, Tennessee », « Florence, Alabama »,
     * « Manchester, New Hampshire » sont aux ÉTATS-UNIS. Une lecture naïve du nom de ville rendait
     * FR, IT et GB — et accusait le pipeline d'une erreur qu'il n'avait pas commise. Le
     * qualificatif qui SUIT la ville prime toujours sur la ville elle-même.
     *
     * On neutralise donc le signal ville dès qu'un État américain, une province canadienne ou un
     * nom de pays explicite accompagne le libellé. Ce qui reste indécidable devient AMBIGU, jamais
     * une contradiction : accuser à tort est pire que ne pas conclure.
     */
    const suffixeAmericain = /,\s*(alabama|alaska|arizona|arkansas|california|colorado|connecticut|delaware|florida|georgia|hawaii|idaho|illinois|indiana|iowa|kansas|kentucky|louisiana|maine|maryland|massachusetts|michigan|minnesota|mississippi|missouri|montana|nebraska|nevada|new hampshire|new jersey|new mexico|new york|north carolina|north dakota|ohio|oklahoma|oregon|pennsylvania|rhode island|south carolina|south dakota|tennessee|texas|utah|vermont|virginia|washington|west virginia|wisconsin|wyoming|puerto rico|d\.?c\.?)\b/i;
    const suffixeCanadien = /,\s*(alberta|british columbia|manitoba|new brunswick|newfoundland|nova scotia|ontario|prince edward|quebec|québec|saskatchewan|bc|ab|on|qc|ns|nb|mb|sk)\b/i;
    const porteUnPays = Object.keys(NOMS_PAYS).some((nom) => t.includes(`, ${nom}`));
    const qualifie = suffixeAmericain.test(texte) || suffixeCanadien.test(texte) || porteUnPays;
    if (!qualifie) {
      for (const [ville, code] of Object.entries(VILLES_SANS_DOUTE)) {
        if (t === ville || t.startsWith(`${ville},`) || t.includes(`, ${ville},`) || t.endsWith(`, ${ville}`)) {
          trouves.push({ champ: cle, valeur: texte.slice(0, 80), pays: code, force: 'VILLE' }); break;
        }
      }
    } else if (suffixeAmericain.test(texte)) {
      trouves.push({ champ: cle, valeur: texte.slice(0, 80), pays: 'US', force: 'VILLE' });
    } else if (suffixeCanadien.test(texte)) {
      trouves.push({ champ: cle, valeur: texte.slice(0, 80), pays: 'CA', force: 'VILLE' });
    }
  }
  return { trouves, ambigus, presents };
}

type Ligne = { sourceKey: string; kind: string; externalId: string | null; publiee: boolean;
  produit: string | null; classe: string; motif: string; champs: string[];
  signaux: Array<{ champ: string; valeur: string; pays: string }> };

const total = await prisma.sourceExtraction.count();
console.log(`\nAUDIT GÉOGRAPHIQUE — ${total} extraction(s) conservée(s)\n`);

const resultats: Ligne[] = [];
const PAS = 500;
let lus = 0, illisibles = 0;

for (let offset = 0; ; offset += PAS) {
  if (limite && lus >= limite) break;
  const lot = await prisma.$queryRawUnsafe<Array<{ outputHash: string; externalId: string | null;
    sourceKey: string; kind: string }>>(`
    SELECT e."outputHash", e."externalId", b."sourceKey", s.kind
      FROM "SourceExtraction" e JOIN "CaptureBatch" b ON b.id=e."batchId"
      JOIN "Source" s ON s.key=b."sourceKey" ORDER BY e.id LIMIT ${PAS} OFFSET ${offset}`);
  if (!lot.length) break;

  for (const row of lot) {
    if (limite && lus >= limite) break;
    let sortieJson: Record<string, unknown>;
    try { sortieJson = JSON.parse((await readRawBlob(prisma, row.outputHash)).toString('utf8')); }
    catch { illisibles++; continue; }
    lus++;

    const { trouves, ambigus, presents } = signaux(sortieJson);
    // Le pays PRODUIT par le pipeline, lu dans la sortie d'adaptateur (`country`), puis confronté.
    const produit = typeof sortieJson.country === 'string' && ISO2.test(String(sortieJson.country).toUpperCase())
      ? String(sortieJson.country).toUpperCase() : null;
    // Les signaux INDÉPENDANTS du champ `country` lui-même : c'est lui qu'on met à l'épreuve.
    const independants = trouves.filter((t) => t.champ !== 'country' && t.champ !== 'countryCode');
    const paysIndep = [...new Set(independants.map((t) => t.pays))];

    let classe: string, motif: string;
    if (!produit) {
      classe = 'NON_PROUVABLE'; motif = presents.length ? 'aucun pays produit' : 'aucun champ géographique';
    } else if (!paysIndep.length) {
      classe = ambigus.length ? 'AMBIGU' : 'NON_PROUVABLE';
      motif = ambigus.length ? `code ambigu ${ambigus[0].valeur}` : 'aucun signal indépendant du champ pays';
    } else if (paysIndep.length > 1) {
      classe = 'AMBIGU'; motif = `signaux divergents : ${paysIndep.join('/')}`;
    } else if (paysIndep[0] === produit) {
      classe = 'CONFIRME'; motif = `${independants[0].champ} → ${paysIndep[0]}`;
    } else {
      classe = 'CONTRADICTOIRE'; motif = `${independants[0].champ}="${independants[0].valeur}" → ${paysIndep[0]}, produit ${produit}`;
    }

    resultats.push({ sourceKey: row.sourceKey, kind: row.kind, externalId: row.externalId,
      publiee: false, produit, classe, motif, champs: presents,
      signaux: trouves.map((t) => ({ champ: t.champ, valeur: t.valeur, pays: t.pays })) });
  }
  if (lus % 5000 < PAS) console.log(`   ${lus} lue(s)…`);
}

/* Les extractions publiées, pour séparer le biais de publication. */
const publiees = new Set((await prisma.$queryRawUnsafe<Array<{ k: string }>>(
  `SELECT "sourceKey" || '|' || "externalId" AS k FROM "JobSource"`)).map((r) => r.k));
for (const r of resultats) r.publiee = publiees.has(`${r.sourceKey}|${r.externalId}`);

const compte = (xs: Ligne[]) => {
  const m = new Map<string, number>();
  for (const x of xs) m.set(x.classe, (m.get(x.classe) ?? 0) + 1);
  return m;
};
const pct = (n: number, d: number) => d ? `${(100 * n / d).toFixed(2).padStart(6)} %` : '     — ';
const CLASSES = ['CONFIRME', 'CONTRADICTOIRE', 'AMBIGU', 'NON_PROUVABLE'];

console.log(`\n${'═'.repeat(76)}\n1. GLOBAL — ${lus} extraction(s) lue(s)${illisibles ? ` · ${illisibles} illisible(s)` : ''}\n`);
const g = compte(resultats);
for (const c of CLASSES) console.log(`   ${c.padEnd(16)} ${String(g.get(c) ?? 0).padStart(7)}   ${pct(g.get(c) ?? 0, lus)}`);

console.log(`\n2. PUBLIÉES vs NON PUBLIÉES — détection de biais\n`);
for (const [nom, xs] of [['publiées', resultats.filter((r) => r.publiee)], ['non publiées', resultats.filter((r) => !r.publiee)]] as const) {
  const m = compte(xs);
  console.log(`   ${nom} (${xs.length}) : ` + CLASSES.map((c) => `${c.slice(0, 7)} ${pct(m.get(c) ?? 0, xs.length)}`).join(' · '));
}

console.log(`\n3. PAR FAMILLE DE CONNECTEUR\n`);
const familles = new Map<string, Ligne[]>();
for (const r of resultats) familles.set(r.kind, [...(familles.get(r.kind) ?? []), r]);
console.log(`   ${'famille'.padEnd(26)} ${'total'.padStart(7)} ${'confirmé'.padStart(9)} ${'contrad.'.padStart(9)} ${'ambigu'.padStart(8)} ${'non prouv.'.padStart(11)}`);
for (const [k, xs] of [...familles].sort((a, b) => b[1].length - a[1].length)) {
  const m = compte(xs);
  console.log(`   ${k.padEnd(26)} ${String(xs.length).padStart(7)} ${pct(m.get('CONFIRME') ?? 0, xs.length)} ${pct(m.get('CONTRADICTOIRE') ?? 0, xs.length)} ${pct(m.get('AMBIGU') ?? 0, xs.length)} ${pct(m.get('NON_PROUVABLE') ?? 0, xs.length)}`);
}

console.log(`\n4. CHAMPS GÉOGRAPHIQUES RÉELLEMENT PRÉSENTS, par famille\n`);
for (const [k, xs] of [...familles].sort((a, b) => b[1].length - a[1].length)) {
  const champs = new Map<string, number>();
  for (const r of xs) for (const c of r.champs) champs.set(c, (champs.get(c) ?? 0) + 1);
  const liste = [...champs].sort((a, b) => b[1] - a[1])
    .map(([c, n]) => `${c} ${(100 * n / xs.length).toFixed(0)}%`).join(' · ');
  console.log(`   ${k.padEnd(26)} ${liste || '(aucun)'}`);
}

console.log(`\n5. PAYS PRODUIT — répartition\n`);
const parPays = new Map<string, Ligne[]>();
for (const r of resultats) parPays.set(r.produit ?? '(aucun)', [...(parPays.get(r.produit ?? '(aucun)') ?? []), r]);
for (const [pays, xs] of [...parPays].sort((a, b) => b[1].length - a[1].length).slice(0, 15)) {
  const m = compte(xs);
  console.log(`   ${pays.padEnd(10)} ${String(xs.length).padStart(7)}   confirmé ${pct(m.get('CONFIRME') ?? 0, xs.length)} · contradictoire ${pct(m.get('CONTRADICTOIRE') ?? 0, xs.length)}`);
}

console.log(`\n6. CONTRADICTIONS — motifs les plus fréquents\n`);
const contradictions = resultats.filter((r) => r.classe === 'CONTRADICTOIRE');
const motifs = new Map<string, number>();
for (const r of contradictions) {
  const cle = `${r.signaux.find((s) => s.champ !== 'country')?.pays ?? '?'} vu, ${r.produit} produit`;
  motifs.set(cle, (motifs.get(cle) ?? 0) + 1);
}
for (const [m, n] of [...motifs].sort((a, b) => b[1] - a[1]).slice(0, 12)) console.log(`   ${m.padEnd(34)} ${String(n).padStart(6)}`);

console.log(`\n7. EXEMPLES REPRODUCTIBLES (sourceKey / externalId)\n`);
for (const r of contradictions.slice(0, 12)) {
  console.log(`   ${r.sourceKey}/${r.externalId} [${r.kind}] ${r.motif}`);
}

if (sortie) {
  writeFileSync(sortie, JSON.stringify(resultats, null, 1));
  console.log(`\n   détail complet écrit dans ${sortie}`);
}
console.log('');
await prisma.$disconnect();
