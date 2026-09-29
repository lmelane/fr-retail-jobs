/**
 * APPELS AU MODÈLE DE LA PASSE DE CURATION (D-475 §30-§31 ; plan `docs/architecture/classification-metiers.md` §3.2).
 *
 * Hors ligne seulement, jamais pendant une recherche (D-475 §20). Trois primitives :
 *  - `vecteurs` : proximité de sens (`gemini-embedding-001`, `SEMANTIC_SIMILARITY`), avec un cache sur disque ;
 *  - `repondre` : un modèle répond pour chaque élément d'une liste, par lots, en JSON contraint par un schéma ; une
 *    réponse coupée ou incomplète est redemandée en lots plus petits, jamais perdue sans trace ;
 *  - `consensus` : les deux juges de D-127 (R-66 §2), avec les consignes et les modèles du backend
 *    (`catwalks-backend/src/lib/verify-job-mapping.ts`) : deux « même métier » et confiance minimale 0,9, fail-closed.
 * La clé vient de l'environnement (`GEMINI_API_KEY`), jamais affichée.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

const CLE = process.env.GEMINI_API_KEY;
if (!CLE) throw new Error('GEMINI_API_KEY absente');
const API = 'https://generativelanguage.googleapis.com/v1beta/models';
export const MODELE_CHOIX = 'gemini-3.6-flash';
export const JUGES = { j1: 'gemini-3.6-flash', j2: 'gemini-3-flash-preview' } as const;
export const SEUIL_CONSENSUS = 0.9;
/** Lots envoyés en même temps par `repondre`. */
const PARALLELE = 4;

async function appeler(url: string, corps: unknown): Promise<any> {
  for (let essai = 1; ; essai++) {
    const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-goog-api-key': CLE! }, body: JSON.stringify(corps) });
    if (r.ok) return r.json();
    if (essai >= 8 || ![429, 500, 503].includes(r.status)) throw new Error(`Gemini ${r.status} : ${(await r.text()).slice(0, 300)}`);
    await new Promise((ok) => setTimeout(ok, Math.min(90_000, 8_000 * essai)));
  }
}

/** Vecteurs unitaires, en cache (clé = texte). */
export async function vecteurs(textes: string[], cheminCache: string): Promise<Map<string, number[]>> {
  const cache: Record<string, number[]> = existsSync(cheminCache) ? JSON.parse(readFileSync(cheminCache, 'utf8')) : {};
  const manquants = [...new Set(textes)].filter((t) => !cache[t]);
  for (let i = 0; i < manquants.length; i += 100) {
    const lot = manquants.slice(i, i + 100);
    const r = await appeler(`${API}/gemini-embedding-001:batchEmbedContents`, {
      requests: lot.map((t) => ({ model: 'models/gemini-embedding-001', content: { parts: [{ text: t }] }, taskType: 'SEMANTIC_SIMILARITY', outputDimensionality: 768 })),
    });
    r.embeddings.forEach((e: { values: number[] }, j: number) => { cache[lot[j]] = e.values; });
    mkdirSync(dirname(cheminCache), { recursive: true });
    writeFileSync(cheminCache, JSON.stringify(cache));
  }
  const unitaire = (v: number[]) => { const n = Math.hypot(...v); return v.map((x) => x / n); };
  return new Map(textes.map((t) => [t, unitaire(cache[t])]));
}
export const cosinus = (a: number[], b: number[]) => a.reduce((s, x, i) => s + x * b[i], 0);

/** Réponse du modèle coupée (plafond de sortie atteint : le raisonnement le consomme) ou illisible. */
export class ReponseIncomplete extends Error {}

/**
 * Un modèle répond, pour un lot, par un tableau JSON (contraint par `schemaElement` s'il est donné).
 * Une réponse coupée ou illisible LÈVE `ReponseIncomplete` : elle n'est jamais rendue comme un tableau vide, qui
 * ferait disparaître le lot sans trace (défaut mesuré le 28/09/2026 : 40 fusions sur 44 sans verdict du second juge,
 * dont le raisonnement sur 20 paires dépassait le plafond de sortie).
 */
export async function generer(modele: string, consigne: string, texte: string, schemaElement?: unknown): Promise<any[]> {
  const r = await appeler(`${API}/${modele}:generateContent`, {
    contents: [{ parts: [{ text: `${consigne}\n\n${texte}` }] }],
    generationConfig: { temperature: 0, responseMimeType: 'application/json', maxOutputTokens: 32768,
      ...(schemaElement ? { responseSchema: { type: 'ARRAY', items: schemaElement } } : {}) },
  });
  const fin = r.candidates?.[0]?.finishReason;
  if (fin !== 'STOP') throw new ReponseIncomplete(`${modele} : fin « ${fin ?? 'absente'} »`);
  const brut = (r.candidates[0].content?.parts ?? []).map((p: { text?: string }) => p.text ?? '').join('');
  const bloc = brut.match(/\[[\s\S]*\]/);
  try {
    const tableau = bloc ? JSON.parse(bloc[0]) : null;
    if (Array.isArray(tableau)) return tableau;
  } catch { /* signalé ci-dessous */ }
  throw new ReponseIncomplete(`${modele} : réponse illisible (${brut.slice(0, 80)})`);
}

/**
 * Réponses d'un modèle ALIGNÉES sur `elements` (l'indice `i` de chaque réponse désigne l'élément dans son lot), par lots
 * de `taille`. Un élément sans réponse valide (réponse coupée, indice absent, `valide` refusé) est redemandé dans un lot
 * deux fois plus petit, jusqu'à l'élément seul ; seul un élément seul qui échoue encore reste `undefined`.
 */
export async function repondre<T>(modele: string, consigne: string, elements: T[], taille: number,
  rendu: (lot: T[]) => string, schemaElement: unknown, valide: (r: any) => boolean = () => true): Promise<any[]> {
  const sortie: any[] = new Array(elements.length);
  let coupes = 0;
  async function lot(indices: number[]): Promise<void> {
    try {
      const reps = await generer(modele, consigne, rendu(indices.map((k) => elements[k])), schemaElement);
      for (const r of reps) if (Number.isInteger(r?.i) && r.i >= 0 && r.i < indices.length && sortie[indices[r.i]] === undefined && valide(r))
        sortie[indices[r.i]] = r;
    } catch (e) {
      if (!(e instanceof ReponseIncomplete)) throw e;
      coupes++;
      process.stderr.write(`\n[${e.message} sur un lot de ${indices.length} : redécoupé]\n`);
    }
    const manquants = indices.filter((k) => sortie[k] === undefined);
    if (manquants.length && indices.length > 1) {
      const moitie = Math.ceil(manquants.length / 2);
      await lot(manquants.slice(0, moitie));
      if (manquants.length > moitie) await lot(manquants.slice(moitie));
    }
  }
  // Les lots partent `PARALLELE` par `PARALLELE` : le débit est borné par l'API (429 → relance), pas par la file.
  const departs = Array.from({ length: Math.ceil(elements.length / taille) }, (_, n) => n * taille);
  let suivant = 0, faits = 0;
  await Promise.all(Array.from({ length: Math.min(PARALLELE, departs.length) }, async () => {
    while (suivant < departs.length) {
      const d = departs[suivant++];
      await lot(Array.from({ length: Math.min(taille, elements.length - d) }, (_, j) => d + j));
      faits += Math.min(taille, elements.length - d);
      process.stderr.write(`\r${modele} ${faits} / ${elements.length}`);
    }
  }));
  const sansReponse = sortie.filter((r, k) => k < elements.length && r === undefined).length + (elements.length - sortie.length);
  process.stderr.write(`\n${modele} : ${coupes} lot(s) coupé(s) et redécoupé(s), ${sansReponse} élément(s) sans réponse\n`);
  return sortie;
}

// Consignes des deux juges, recopiées de `catwalks-backend/src/lib/verify-job-mapping.ts` (JUDGE_PROMPT, JUDGE2_PROMPT).
export const CONSIGNE_J1 = `Tu es un expert des métiers du retail, de la mode, de la beauté et du luxe.
On te donne l'intitulé de poste RÉEL d'un candidat, et un métier de référentiel qu'un classifieur a choisi pour lui.
Question UNIQUE : ces deux intitulés désignent-ils le MÊME métier, au sens de la FONCTION exercée ?
- Ce n'est PAS une question de secteur : « vendeur en parfumerie » et « animateur des ventes » sont dans le même univers mais ne sont pas le même métier.
- Les synonymes, traductions, féminisés et variantes proches comptent comme le même métier (« Sales Advisor » = « Conseiller de vente »).
- Un intitulé plus large ou plus précis mais de même cœur de fonction compte comme le même métier (« Conseillère de vente en parfumerie » = « Conseiller de vente »).
- IGNORE ce qui n'est pas la fonction : la casse, les préfixes administratifs (« MISSION - », « STAGE - », « CDI »), les mentions de contrat ou d'horaire (« H/F », « 35h », « intérimaire »), et les mentions de secteur, d'univers ou de gamme (« secteur beauté et luxe », « premium », « prêt-à-porter », « dermo-cosmétique »). Juge le métier qui reste une fois ces mentions retirées.`;
export const CONSIGNE_J2 = `Tu es un contrôleur SCEPTIQUE des taxonomies de métiers (retail, mode, beauté, luxe).
On te donne l'intitulé de poste RÉEL d'un candidat, et un métier de référentiel qu'on veut lui associer DÉFINITIVEMENT.
Ta mission : trouver pourquoi ce n'est PAS le même métier. Cherche la différence de FONCTION, de niveau de responsabilité, de cœur de tâche — pas de secteur.
- Réponds meme_metier = true UNIQUEMENT si tu n'as trouvé AUCUNE différence de fonction (synonymes, traductions, féminisés, variantes de précision acceptés).
- En cas de doute, réponds false : une association fausse corrompt le référentiel pour tous les candidats.
- IGNORE ce qui n'est pas la fonction : casse, préfixes administratifs (« MISSION - », « STAGE - », « CDI »), contrat/horaire (« H/F », « 35h »), secteur, univers ou gamme.`;
export const FORMAT_JUGE = `Plusieurs paires te sont données, numérotées. Pour CHAQUE paire, réponds indépendamment.
Réponds en JSON strict : un tableau d'objets {"i": numéro, "meme_metier": true ou false, "confiance": 0.0 à 1.0}.`;

export type Paire = { intitule: string; metier: string; alias?: string[]; contexte?: string };
export type Verdict = 'confirme' | 'rejete' | 'indetermine';

const SCHEMA_JUGE = { type: 'OBJECT', properties: { i: { type: 'INTEGER' }, meme_metier: { type: 'BOOLEAN' }, confiance: { type: 'NUMBER' } },
  required: ['i', 'meme_metier', 'confiance'] };
const LOT_JUGE = 10;

/** Consensus des deux juges (D-127, R-66 §2) : deux « même métier » et confiance minimale 0,9 ; sans verdict = indéterminé. */
export async function consensus(paires: Paire[]): Promise<Verdict[]> {
  const rendu = (lot: Paire[]) => lot.map((p, j) => `[${j}] Intitulé du candidat : "${p.intitule}"${p.contexte ? ` (${p.contexte})` : ''} — Métier choisi : "${p.metier}"${p.alias?.length ? ` (alias connus : ${p.alias.slice(0, 8).join(', ')})` : ''}`).join('\n');
  const valide = (r: any) => typeof r.meme_metier === 'boolean' && typeof r.confiance === 'number';
  const parJuge: Record<'j1' | 'j2', any[]> = { j1: [], j2: [] };
  for (const juge of ['j1', 'j2'] as const)
    parJuge[juge] = await repondre(JUGES[juge], `${juge === 'j1' ? CONSIGNE_J1 : CONSIGNE_J2}\n\n${FORMAT_JUGE}`, paires, LOT_JUGE, rendu, SCHEMA_JUGE, valide);
  return paires.map((_, n) => {
    const a = parJuge.j1[n], b = parJuge.j2[n];
    if (!a || !b) return 'indetermine';
    return a.meme_metier && b.meme_metier && Math.min(1, Math.max(0, a.confiance), Math.max(0, b.confiance)) >= SEUIL_CONSENSUS ? 'confirme' : 'rejete';
  });
}

export type Regroupe = { cle: string; fr: string; en: string; verdict: Verdict } | null;

/**
 * Regroupe des intitulés qui désignent chacun un métier absent de la taxonomie : un modèle propose les groupes (même
 * clé pour le même métier) et la forme courte du libellé (D-475 §31 c), puis chaque rattachement d'un intitulé à son
 * groupe passe au consensus des deux juges. Rend, pour chaque intitulé, son groupe et le verdict (null sans groupe).
 */
export async function regrouper(elements: { intitule: string; fr: string | null; en: string | null; contexte?: string }[]): Promise<Regroupe[]> {
  const consigne = `Tu construis la taxonomie des métiers de Catwalks. Voici des intitulés d'offres qui désignent chacun un métier absent de la taxonomie, avec le nom proposé.
Regroupe ceux qui désignent le MÊME métier (même fonction, même niveau) : ils reçoivent EXACTEMENT la même "cle" (identifiant en minuscules, mots anglais séparés par des tirets). Pour chaque intitulé, donne aussi le nom court du métier du groupe en français ("fr") et en anglais ("en"), identique pour tout le groupe, sans H/F, contrat, marque, secteur ni lieu.`;
  const schema = { type: 'OBJECT', properties: { i: { type: 'INTEGER' }, cle: { type: 'STRING' }, fr: { type: 'STRING' }, en: { type: 'STRING' } }, required: ['i', 'cle', 'fr', 'en'] };
  const groupes = await repondre(MODELE_CHOIX, consigne, elements, 250,
    (lot) => lot.map((e, j) => `[${j}] « ${e.intitule} »${e.contexte ? ` (${e.contexte})` : ''} — proposé : ${e.fr ?? ''} / ${e.en ?? ''}`).join('\n'),
    schema, (r) => /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/.test(r.cle));
  // Le nom d'un groupe est celui de son premier membre : un même groupe porte un seul nom.
  const nom = new Map<string, { fr: string; en: string }>();
  for (const g of groupes) if (g && !nom.has(g.cle)) nom.set(g.cle, { fr: g.fr, en: g.en });
  const aJuger = elements.map((e, k) => ({ e, g: groupes[k] })).filter((x) => x.g);
  const verdicts = await consensus(aJuger.map(({ e, g }) => ({ intitule: e.intitule, contexte: e.contexte, metier: `${nom.get(g.cle)!.fr} / ${nom.get(g.cle)!.en}` })));
  const parElement = new Map(aJuger.map(({ e }, n) => [e, verdicts[n]]));
  return elements.map((e, k) => (groupes[k] ? { cle: groupes[k].cle, ...nom.get(groupes[k].cle)!, verdict: parElement.get(e)! } : null));
}
