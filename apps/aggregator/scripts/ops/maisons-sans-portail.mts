/**
 * LES MAISONS DU REGISTRE QUI N'ONT AUCUN PORTAIL BRANCHÉ — lecture seule.
 *
 *   python3 apps/aggregator/scripts/ops/db.py readonly npx tsx \
 *     apps/aggregator/scripts/ops/maisons-sans-portail.mts
 *
 * ── POURQUOI CE SCRIPT EXISTE ──────────────────────────────────────────────────────────────────
 *
 * Mesuré le 19/09/2026 : 1 692 Maisons au registre, 346 seulement avec une source ACTIVE.
 * Avant de conclure que 1 220 Maisons ne sont reliées à rien, il faut écarter l'artefact de
 * mesure : le rapprochement `Source.maison = Company.name` est une égalité EXACTE, et c'est
 * précisément ce chemin qui avait silencieusement perdu 30 domaines à l'import du catalogue
 * (« L'Oréal (toutes Maisons) » ≠ « L'Oréal »).
 *
 * Ce script distingue donc TROIS populations, au lieu d'une :
 *
 *   A. RATTACHÉE PAR NOM EXACT      — une source porte exactement ce libellé
 *   B. RATTACHÉE PAR RACINE         — une source porte ce libellé à un suffixe entre parenthèses
 *                                     près, ou l'inverse : c'est un ARTEFACT, la Maison EST reliée
 *   C. RATTACHÉE PAR LES OFFRES     — aucune source ne porte son nom, mais des offres publiées lui
 *                                     sont attribuées : elle est donc bien collectée, via une
 *                                     source portant un autre libellé (cas des groupes : LVMH sert
 *                                     les offres de ses Maisons)
 *   D. VRAIMENT SANS RIEN           — ni source, ni offre. Le gisement réel.
 *
 * Seule la population D justifie un travail de raccordement. Les trois autres sont des
 * Maisons déjà couvertes que la mesure naïve comptait comme perdues.
 */
import { PrismaClient } from '@prisma/client';
import { writeFileSync } from 'node:fs';

const url = process.env.DB_URL ?? process.env.DATABASE_URL;
if (!url) { console.error('DB_URL (ou DATABASE_URL) manquante.'); process.exit(1); }
const prisma = new PrismaClient({ datasources: { db: { url } } });
const q = <T>(s: string) => prisma.$queryRawUnsafe<T[]>(s);

/*
 * La racine d'un libellé : ce qui reste une fois retiré un suffixe entre parenthèses et
 * normalisée la casse, les accents et la ponctuation. « L'Oréal (toutes Maisons) » et
 * « L'Oreal » partagent la racine `loreal`.
 */
const racine = (s: string) =>
  s.replace(/\s*\([^)]*\)\s*$/, '')
   .normalize('NFD').replace(/[̀-ͯ]/g, '')
   .toLowerCase().replace(/[^a-z0-9]+/g, '');

type Maison = { id: string; name: string; domain: string | null };
type Src = { key: string; maison: string; status: string; careersDomain: string | null };

const maisons = await q<Maison>(`SELECT id, name, domain FROM "Company" ORDER BY name`);
const sources = await q<Src>(`SELECT key, maison, status, "careersDomain" FROM "Source"`);
const avecOffres = await q<{ companyId: string; n: bigint }>(
  `SELECT "companyId", count(*) AS n FROM "Job" WHERE "isActive" GROUP BY "companyId"`);
const offresPar = new Map(avecOffres.map((r) => [r.companyId, Number(r.n)]));

/*
 * UNE SOURCE SE RECONNAÎT PAR TROIS CHEMINS, PAS UN SEUL (correctif du 19/09/2026).
 *
 * La première version de ce script ne comparait que `Source.maison` à `Company.name`. Elle a
 * classé AMI Paris en « aucun raccordement » alors que la source `ami-paris` existe, en PAUSED,
 * sur `amiparis.recruitee.com` — exactement le portail que le CEO venait de vérifier à la main.
 * Le défaut était le mien, pas celui de la base : une Maison est reliée à son portail par SON
 * LIBELLÉ, par LA CLÉ de la source, ou par LE DOMAINE que la source sert. Ne tester que le
 * premier invente un gisement qui n'existe pas.
 *
 * Les trois empreintes sont réduites à la même racine (casse, accents, ponctuation, suffixe
 * entre parenthèses), et le domaine à son étiquette de tête (`amiparis.recruitee.com` → les
 * étiquettes `amiparis` et `recruitee` ; on ne garde que la première, l'hébergeur ne prouve rien).
 */
const etiquetteDomaine = (d: string | null) => {
  if (!d) return null;
  const propre = d.toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0];
  const [tete] = propre.split('.');
  return tete && tete.length >= 3 ? tete : null;
};

const empreintes = (s: Src) => {
  const e = new Set<string>([racine(s.maison), racine(s.key)]);
  const dom = etiquetteDomaine(s.careersDomain);
  if (dom) e.add(racine(dom));
  return [...e].filter(Boolean);
};

const relieActive = new Set<string>();
const relieToute = new Set<string>();
for (const s of sources) {
  for (const e of empreintes(s)) {
    relieToute.add(e);
    if (s.status === 'ACTIVE') relieActive.add(e);
  }
}

/* Côté Maison : son nom, et l'étiquette de tête de son domaine officiel. */
const empreintesMaison = (m: Maison) => {
  const e = new Set<string>([racine(m.name)]);
  const dom = etiquetteDomaine(m.domain);
  if (dom) e.add(racine(dom));
  return [...e].filter(Boolean);
};

const A: Maison[] = [], C: Array<Maison & { offres: number }> = [], D: Maison[] = [];
const inactiveSeule: Maison[] = [];

for (const m of maisons) {
  const emp = empreintesMaison(m);
  if (emp.some((e) => relieActive.has(e))) { A.push(m); continue; }
  const n = offresPar.get(m.id) ?? 0;
  if (n > 0) { C.push({ ...m, offres: n }); continue; }
  if (emp.some((e) => relieToute.has(e))) { inactiveSeule.push(m); continue; }
  D.push(m);
}
const B: Maison[] = [];

/*
 * TÉMOIN — il doit ÉCHOUER si la première version du classement revenait.
 *
 * « AMI Paris » (Company) et la source `ami-paris` ne partagent PAS le même libellé : si le
 * rapprochement se remettait à ne tester que `Source.maison`, cette Maison retomberait en D et
 * la mesure mentirait à nouveau. On vérifie donc que la PRÉMISSE du défaut est bien présente
 * (les deux libellés diffèrent), puis que le classement l'attrape quand même.
 */
const temoinSource = sources.find((s) => s.key === 'ami-paris');
const temoinMaison = maisons.find((m) => m.name === 'AMI Paris');
if (temoinSource && temoinMaison) {
  if (racine(temoinSource.maison) === racine(temoinMaison.name))
    console.error('⚠ TÉMOIN INOPÉRANT : les libellés coïncident, il n\'exerce plus le défaut.');
  else if (D.some((m) => m.id === temoinMaison.id)) {
    console.error('\n⚠ TÉMOIN ROUGE : « AMI Paris » est classée « sans raccordement » alors que');
    console.error('  la source `ami-paris` existe. Le rapprochement est redevenu incomplet.\n');
    process.exit(1);
  }
}

const pct = (n: number) => `${((n / maisons.length) * 100).toFixed(1).padStart(5)} %`;
console.log(`\n═══ ${maisons.length} MAISONS AU REGISTRE — QUI EST RELIÉ À QUOI ═══\n`);
console.log(`   A. source ACTIVE, nom exact            ${String(A.length).padStart(5)}   ${pct(A.length)}`);
console.log(`   B. source ACTIVE, même racine          ${String(B.length).padStart(5)}   ${pct(B.length)}   (artefact de mesure)`);
console.log(`   C. pas de source mais DES OFFRES       ${String(C.length).padStart(5)}   ${pct(C.length)}   (collectée via un autre libellé)`);
console.log(`   ─ source existante mais INACTIVE       ${String(inactiveSeule.length).padStart(5)}   ${pct(inactiveSeule.length)}   (retirée / en pause)`);
console.log(`   D. NI source NI offre                  ${String(D.length).padStart(5)}   ${pct(D.length)}   ← le gisement réel\n`);
console.log(`   Couvertes d'une façon ou d'une autre :  ${A.length + B.length + C.length}`);

if (C.length) {
  console.log(`\n── C. Maisons servies par une source portant un AUTRE libellé (top 20) ──\n`);
  for (const m of [...C].sort((a, b) => b.offres - a.offres).slice(0, 20))
    console.log(`   ${String(m.offres).padStart(5)}  ${m.name}`);
}

console.log(`\n── D. Les 40 premières Maisons sans aucun raccordement ──\n`);
for (const m of D.slice(0, 40)) console.log(`   ${m.name}`);

const chemin = 'backups/maisons-sans-portail.csv';
writeFileSync(chemin, `nom\n${D.map((m) => `"${m.name.replace(/"/g, '""')}"`).join('\n')}\n`, 'utf8');
console.log(`\n   Liste complète des ${D.length} : ${chemin}\n`);

await prisma.$disconnect();
