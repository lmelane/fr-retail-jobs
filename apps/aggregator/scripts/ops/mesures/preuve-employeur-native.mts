/**
 * Y A-T-IL UNE PREUVE D'EMPLOYEUR DANS LE PAYLOAD NATIF ? — la question qui clôt
 * `PORTAL_OWNER_NOT_CERTIFIED`.
 *
 * ── CE QUE LE REFUS SIGNIFIE ───────────────────────────────────────────────────────────────────
 *
 * `SOURCE_CATALOGUE_LABEL` veut dire : la page native N'A NOMMÉ AUCUN employeur, et l'étiquette
 * vient du registre. La règle (`identity/resolve.ts:40`) refuse alors d'attribuer l'employeur,
 * sauf si le portail est certifié SINGLE_BRAND — parce qu'un portail multi-marques ne permet pas
 * de déduire qui recrute.
 *
 * Avant de classer une source en `NON_DETERMINABLE_PROUVE`, il faut donc LIRE le RAW et vérifier
 * qu'aucun champ exploitable n'y porte la marque ou l'employeur. C'est la seule façon de
 * distinguer :
 *
 *   PREUVE_NATIVE_DISPONIBLE  un champ porte la marque → traitement possible, correction ciblée
 *   NON_DETERMINABLE_PROUVE   lecture faite, aucun champ ne la porte → état final, sujet clos
 *
 * On ne cherche pas indéfiniment : on lit les clés réellement présentes dans le RAW archivé, et
 * on nomme celles qui contiennent quelque chose ressemblant à un employeur.
 */
import { PrismaClient } from '@prisma/client';
import { readRawBlob } from '../../../src/capture/store.js';

const p = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL } } });

/** Les noms de champ qui, dans les ATS rencontrés, portent une marque ou un employeur. */
const INDICES = /brand|employer|company|entity|legal|division|societ|marque|organization|subsidiary|business_?unit|bu_|banner/i;

for (const cle of process.argv.slice(2)) {
  const [b] = await p.$queryRawUnsafe<Array<{ id: string; sourceKind: string }>>(`
    SELECT b.id, b."sourceKind" FROM "CaptureBatch" b
      JOIN "CaptureOutcome" o ON o."batchId" = b.id AND o.status = 'EXTRACTED'
     WHERE b."sourceKey" = $1 AND b.purpose = 'JOBS'
     ORDER BY b."startedAt" DESC LIMIT 1`, cle);
  if (!b) { console.log(`\n── ${cle} : aucun lot EXTRACTED`); continue; }

  const captures = await p.$queryRawUnsafe<Array<{ blobHash: string; requestUrl: string }>>(`
    SELECT "blobHash", "requestUrl" FROM "RawCapture"
     WHERE "batchId" = $1 AND "blobHash" IS NOT NULL AND complete = true
     ORDER BY sequence LIMIT 1`, b.id);
  if (!captures.length) { console.log(`\n── ${cle} : aucune réponse native archivée`); continue; }

  console.log(`\n── ${cle} (${b.sourceKind})`);
  const brut = (await readRawBlob(p, captures[0].blobHash)).toString('utf8');

  let charge: unknown;
  try { charge = JSON.parse(brut); }
  catch {
    /* Payload non-JSON (HTML) : on cherche les indices dans le texte, sans prétendre l'analyser. */
    const trouves = [...brut.matchAll(/"?([A-Za-z_][\w-]{2,40})"?\s*[:=]\s*"([^"]{2,60})"/g)]
      .filter(m => INDICES.test(m[1])).slice(0, 8);
    console.log(`   format               : non-JSON (${brut.length} octets)`);
    console.log(`   indices d'employeur  : ${trouves.length ? trouves.map(m => `${m[1]}="${m[2]}"`).join(', ') : 'AUCUN'}`);
    continue;
  }

  /* Trouver le premier tableau d'offres, quel que soit son nom : les ATS diffèrent. */
  const pile: Array<{ v: unknown; chemin: string }> = [{ v: charge, chemin: '$' }];
  let offre: Record<string, unknown> | null = null, cheminOffre = '';
  while (pile.length && !offre) {
    const { v, chemin } = pile.shift()!;
    if (Array.isArray(v) && v.length && typeof v[0] === 'object' && v[0]) { offre = v[0] as Record<string, unknown>; cheminOffre = chemin; break; }
    if (v && typeof v === 'object') for (const [k, sv] of Object.entries(v)) pile.push({ v: sv, chemin: `${chemin}.${k}` });
  }
  if (!offre) { console.log(`   aucune offre trouvée dans le payload`); continue; }

  /*
   * DESCENDRE JUSQU'À L'OFFRE RÉELLE. Le premier tableau rencontré est souvent une ENVELOPPE :
   * `items` d'Oracle porte la requête de recherche, `hits.hits` d'Elasticsearch porte des
   * documents dont le contenu est dans `_source`. S'arrêter là ferait conclure « aucun champ
   * d'employeur » sur une enveloppe qui n'en a jamais porté — un faux négatif.
   */
  for (const enveloppe of ['_source', 'requisitionList', 'jobs', 'data']) {
    const dedans = offre[enveloppe];
    if (dedans && typeof dedans === 'object') {
      const cible = Array.isArray(dedans) ? dedans[0] : dedans;
      if (cible && typeof cible === 'object') { offre = cible as Record<string, unknown>; cheminOffre += `.${enveloppe}${Array.isArray(dedans) ? '[0]' : ''}`; }
    }
  }

  console.log(`   offres au chemin     : ${cheminOffre}`);
  const cles = Object.keys(offre);
  console.log(`   champs de l'offre    : ${cles.length} — ${cles.slice(0, 14).join(', ')}${cles.length > 14 ? '…' : ''}`);

  const candidats = cles.filter(k => INDICES.test(k));
  if (!candidats.length) {
    console.log(`   CHAMPS D'EMPLOYEUR   : AUCUN → NON_DETERMINABLE_PROUVE`);
    continue;
  }
  console.log(`   CHAMPS D'EMPLOYEUR   :`);
  for (const k of candidats) {
    const val = offre[k];
    const texte = typeof val === 'object' && val ? JSON.stringify(val).slice(0, 90) : String(val);
    /* Un champ PRÉSENT mais vide ne prouve rien : c'est la distinction qui décide. */
    const vide = val === null || val === undefined || texte === '' || texte === '""' || texte === '{}' || texte === '[]';
    console.log(`     ${k} = ${texte}${vide ? '   ← VIDE, ne prouve rien' : '   ← EXPLOITABLE'}`);
  }
}

await p.$disconnect();
