/**
 * POURQUOI LE PAYS N'EST PAS PROUVÉ — répartition A/B/C, pondérée en OFFRES.
 *
 * ── LE PIÈGE QUE CET OUTIL ÉVITE ───────────────────────────────────────────────────────────────
 *
 * Une première inspection ne lisait que les clés RACINE du RAW et concluait « aucun champ
 * géographique » pour `normal` (NL). En descendant dans `_jobposting.jobLocation[0].address`, le
 * pays était là : `addressCountry: "NL"`, `addressRegion: "Noord-Brabant"`, `postalCode: "4611 MK"`.
 * Un balayage de surface FABRIQUE des `NO_NATIVE_COUNTRY_EVIDENCE`. La recherche est donc
 * RÉCURSIVE, objets et listes compris.
 *
 * ── LES TROIS CATÉGORIES ───────────────────────────────────────────────────────────────────────
 *
 *   PROVENANCE_LOST          la source NOMME le pays sans ambiguïté (un nom, pas deux lettres) et
 *                            notre pipeline ne le reconnaît pas. Récupérable.
 *   WEAK_GEO_SIGNAL          la géographie est riche et compréhensible, mais notre contrat de
 *                            preuve ne sait pas la valoriser — typiquement un code à deux lettres,
 *                            ambigu par doctrine (`CA` = Canada ou Californie), même entouré d'une
 *                            région et d'un code postal.
 *   NO_NATIVE_COUNTRY_EVIDENCE   après lecture récursive, aucun signal exploitable. Limite réelle.
 *
 * La frontière entre les deux premières est le CONTRAT, pas l'intuition : `countryIntegrity.ts`
 * dit qu'un code nu ne prouve rien de plus que le suffixe d'un libellé de lieu. Un NOM de pays,
 * lui, est une preuve indépendante.
 *
 * Aucune correction ici. On mesure, on nomme, on chiffre.
 */
import { PrismaClient } from '@prisma/client';

const url = process.env.DATABASE_URL ?? '';
if (!url) { console.error('DATABASE_URL requise.'); process.exit(2); }
const prisma = new PrismaClient({ datasources: { db: { url } } });

/** Les marchés faibles, et les pays que le registre leur rattache. */
const MARCHES_FAIBLES: ReadonlyArray<readonly [string, readonly string[]]> = [
  ['NL', ['NL']], ['CN', ['CN']], ['DE+AT', ['DE', 'AT']], ['CA', ['CA']],
];
const COUVERTURE_CIBLE = 0.8;

const CLES_GEO = /^(country|countryCode|countryRegion|addressCountry|location|address|region|state|admin1|city|addressLocality|addressRegion|postalCode|zip)$/i;

/** Descend dans les objets ET les listes : le pays vit souvent sous `_jobposting.jobLocation[0]`. */
function signauxGeo(valeur: unknown, chemin = '', trouves: Array<[string, string]> = [], profondeur = 0): Array<[string, string]> {
  if (profondeur > 6 || valeur == null) return trouves;
  if (Array.isArray(valeur)) { for (const v of valeur.slice(0, 3)) signauxGeo(v, `${chemin}[]`, trouves, profondeur + 1); return trouves; }
  if (typeof valeur === 'object') {
    for (const [k, v] of Object.entries(valeur as Record<string, unknown>)) {
      const sous = chemin ? `${chemin}.${k}` : k;
      if (CLES_GEO.test(k) && (typeof v === 'string' || typeof v === 'number')) {
        const texte = String(v).trim();
        if (texte) trouves.push([sous, texte.slice(0, 40)]);
      } else signauxGeo(v, sous, trouves, profondeur + 1);
    }
  }
  return trouves;
}

/**
 * Le verdict, depuis les signaux réellement trouvés. La règle décisive : un NOM de pays prouve,
 * un CODE à deux lettres ne prouve pas — c'est exactement la frontière du contrat.
 */
function categorie(signaux: Array<[string, string]>): string {
  if (!signaux.length) return 'NO_NATIVE_COUNTRY_EVIDENCE';
  const champsPays = signaux.filter(([k]) => /country/i.test(k) && !/region|code/i.test(k.split('.').pop() ?? ''));
  /*
   * UN NOM DE PAYS N'EST PAS TOUJOURS DANS UN CHAMP « country ». Mesuré : `suitsupply` sert
   * « Haarlem, Noord-Holland, Netherlands » dans `offices[].location`, et `la-senza`
   * « Alberta, AB, Canada » dans `location.name`. Une première version ne cherchait le nom que
   * dans un champ nommé `country` et les classait tous deux NO_NATIVE_COUNTRY_EVIDENCE — alors
   * que le pays y est écrit en toutes lettres. On cherche donc le nom PARTOUT dans les signaux.
   */
  const estUnNom = (v: string) => v.length > 3 && !/^[A-Z]{2,3}$/.test(v);
  if (champsPays.some(([, v]) => estUnNom(v))) return 'PROVENANCE_LOST';
  const NOMS_PAYS = /\b(Netherlands|Nederland|Canada|Germany|Deutschland|Österreich|Austria|China|Chinese Mainland|Belgi[ëe]|Schweiz|Suisse|Switzerland|France|Italia|Italy|Espa[ñn]a|Spain|United States|United Kingdom)\b/i;
  if (signaux.some(([, v]) => NOMS_PAYS.test(v))) return 'PROVENANCE_LOST';
  /*
   * UNE VILLE N'EST PAS UN PAYS. Une première version classait `city=Berlin state=Berlin` en
   * PROVENANCE_LOST — au motif implicite que « Berlin ⇒ Allemagne ». C'est de l'INFÉRENCE
   * géographique, pas une preuve fournie par la source : le nom du pays n'est écrit nulle part.
   * PROVENANCE_LOST est réservé au cas où la source NOMME le pays et où nous ne le lisons pas.
   * Tout le reste — ville, subdivision, code postal, code à deux lettres — est un signal riche
   * mais non probant au sens du contrat, donc WEAK_GEO_SIGNAL.
   */
  /* Un code seul, ou une adresse structurée sans nom de pays : la géographie est lisible pour un
   * humain, mais notre contrat de preuve ne la valorise pas en l'état. */
  const geoRiche = signaux.some(([k]) => /postalCode|zip|addressRegion|region|state|admin1|Locality|city/i.test(k));
  if (champsPays.length || geoRiche) return 'WEAK_GEO_SIGNAL';
  return 'NO_NATIVE_COUNTRY_EVIDENCE';
}

console.log(`\n═══ A/B/C — POURQUOI LE PAYS N'EST PAS PROUVÉ ═══\n`);
console.log(`Marché   Source                    Famille              offres  cumul%  signal RAW                              catégorie`);

const totaux = new Map<string, Map<string, number>>();
for (const [marche, pays] of MARCHES_FAIBLES) {
  const liste = pays.map(p => { if (!/^[A-Z]{2}$/.test(p)) throw new Error(`code pays invalide: ${p}`); return `'${p}'`; }).join(',');
  const sources = await prisma.$queryRawUnsafe<Array<{ sourceKey: string; kind: string; n: bigint }>>(`
    WITH p AS (SELECT j.id FROM "Job" j
        WHERE j."isActive" AND j."mergedIntoId" IS NULL AND j."countryCode" IN (${liste})
          AND coalesce(j."countryIntegrity", '') NOT IN ('RAW_COUNTRY_CODE','RAW_COUNTRY','VERIFIED')
          AND EXISTS (SELECT 1 FROM "JobSource" js WHERE js."jobId" = j.id AND js."isActive"
                        AND (js."expiresAt" IS NULL OR js."expiresAt" > now())))
    SELECT js."sourceKey" AS "sourceKey", s.kind, count(*) AS n
      FROM p JOIN "JobSource" js ON js."jobId" = p.id JOIN "Source" s ON s.key = js."sourceKey"
     GROUP BY 1, 2 ORDER BY 3 DESC`);

  const totalMarche = sources.reduce((s, r) => s + Number(r.n), 0);
  const parCategorie = new Map<string, number>();
  let cumul = 0;

  for (const src of sources) {
    const volume = Number(src.n);
    /* On s'arrête à ~80 % : instruire la longue traîne coûterait cher pour ne rien changer. */
    if (cumul / totalMarche >= COUVERTURE_CIBLE) {
      parCategorie.set('NON_INSTRUIT', (parCategorie.get('NON_INSTRUIT') ?? 0) + volume);
      continue;
    }
    /*
     * PLUSIEURS OFFRES, PAS UNE SEULE. Juger une source sur un échantillon de taille 1 rendait le
     * classement instable : `lovisa` et `etam` portent le même `addressCountry=DE` et tombaient
     * dans deux catégories différentes selon l'offre tirée. On agrège les signaux de dix offres et
     * on classe sur l'ensemble.
     */
    const rows = await prisma.$queryRawUnsafe<Array<{ raw: unknown }>>(`
      SELECT js.raw FROM "JobSource" js JOIN "Job" j ON j.id = js."jobId"
       WHERE js."sourceKey" = $1 AND j."countryCode" IN (${liste})
         AND coalesce(j."countryIntegrity", '') NOT IN ('RAW_COUNTRY_CODE','RAW_COUNTRY','VERIFIED')
       LIMIT 10`, src.sourceKey);
    const signaux = rows.flatMap(r => signaux0(r.raw));
    const cat = categorie(signaux);
    cumul += volume;
    parCategorie.set(cat, (parCategorie.get(cat) ?? 0) + volume);
    /*
     * MONTRER LE SIGNAL QUI DÉCIDE, pas les deux premiers. Un extrait tronqué a failli faire
     * reclasser `foot-locker-france` à tort : il affichait « city=Berlin state=Berlin » alors que
     * le RAW porte AUSSI `country = Germany`, à la racine. On affiche donc en priorité le champ
     * qui fonde le verdict.
     */
    const decisif = signaux.filter(([k]) => /country/i.test(k) && !/region|code/i.test(k.split('.').pop() ?? ''));
    const aMontrer = decisif.length ? decisif.slice(0, 2) : signaux.slice(0, 2);
    const extrait = aMontrer.map(([k, v]) => `${k.split('.').pop()}=${v}`).join(' ') || '(aucun)';
    console.log(`${marche.padEnd(8)} ${src.sourceKey.padEnd(25)} ${src.kind.padEnd(20)} ${String(volume).padStart(6)}  ${String(Math.round((100 * cumul) / totalMarche)).padStart(4)}%  ${extrait.slice(0, 38).padEnd(38)}  ${cat}`);
  }
  totaux.set(marche, parCategorie);
  console.log('');
}

function signaux0(raw: unknown): Array<[string, string]> {
  return signauxGeo(raw);
}

console.log(`\n═══ RÉPARTITION PONDÉRÉE EN OFFRES ═══\n`);
const global = new Map<string, number>();
for (const [marche, cats] of totaux) {
  const t = [...cats.values()].reduce((a, b) => a + b, 0);
  console.log(`── ${marche} · ${t} offres non prouvées`);
  for (const [cat, v] of [...cats].sort((a, b) => b[1] - a[1])) {
    console.log(`     ${cat.padEnd(28)} ${String(v).padStart(5)}  ${Math.round((100 * v) / t)}%`);
    global.set(cat, (global.get(cat) ?? 0) + v);
  }
}
const totalGlobal = [...global.values()].reduce((a, b) => a + b, 0);
console.log(`\n── SYNTHÈSE sur les 4 marchés · ${totalGlobal} offres non prouvées`);
for (const [cat, v] of [...global].sort((a, b) => b[1] - a[1])) {
  console.log(`   ${cat.padEnd(28)} ${String(v).padStart(5)}  ${Math.round((100 * v) / totalGlobal)}%`);
}

await prisma.$disconnect();
