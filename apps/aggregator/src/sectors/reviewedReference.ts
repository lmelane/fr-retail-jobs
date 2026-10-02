import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/**
 * La relecture documentée du secteur (D-519) : `data/reference/secteurs-relus.tsv`. Une ligne par Maison relue à la
 * main, avec la source vérifiable (page Wikipédia, page « about » ou catalogue du site officiel), l'extrait exact qui
 * fonde le secteur et la date de lecture. Une ligne `INCONNU` consigne une Maison relue qui reste sans secteur (groupe
 * multisectoriel, activité hors du vocabulaire, doute) : elle n'écrit rien.
 *
 * Identité : `domain:<hôte>` vaut pour toute société qui porte exactement ce domaine officiel (provenance connue, hors
 * groupe), entités juridiques comprises ; `key:<clé canonique>|<nom>` pour une société sans domaine, au nom exact.
 */
export const SECTOR_CODES = ['FASHION', 'LEATHER_GOODS', 'FOOTWEAR', 'JEWELRY', 'WATCHMAKING', 'BEAUTY', 'FRAGRANCE', 'EYEWEAR',
  'HOME_LIFESTYLE', 'WINES_SPIRITS', 'HOSPITALITY', 'LUXURY_MOBILITY', 'ART_DESIGN', 'RETAIL', 'LUXURY_TECH_SERVICES'] as const;

export type ReviewedSector = { cle: string; nom: string; codes: string[]; source: string; extrait: string; verifieLe: string; remarque: string };

const PATH = fileURLToPath(new URL('../../data/reference/secteurs-relus.tsv', import.meta.url));
const COLUMNS = ['cle', 'nom', 'secteurs', 'source', 'extrait', 'verifie_le', 'remarque'];

/** Lit et VALIDE le fichier : une ligne invalide fait échouer la lecture entière plutôt que d'être ignorée. */
export function parseReviewedSectors(text: string): ReviewedSector[] {
  const [header, ...lines] = text.replace(/\r\n/g, '\n').split('\n').filter(l => l.trim() && !l.startsWith('#'));
  if (header?.split('\t').join(',') !== COLUMNS.join(',')) throw new Error(`secteurs-relus.tsv: header must be ${COLUMNS.join(' ')}`);
  const seen = new Set<string>();
  return lines.map((line, i) => {
    const [cle, nom, secteurs, source, extrait, verifieLe, remarque = ''] = line.split('\t');
    const where = `secteurs-relus.tsv line ${i + 2} (${cle})`;
    if (!/^(domain:[a-z0-9.-]+\.[a-z]{2,}|key:[^|]+\|.+)$/.test(cle ?? '')) throw new Error(`${where}: invalid key`);
    if (seen.has(cle)) throw new Error(`${where}: duplicate key`);
    seen.add(cle);
    if (!/^https:\/\/\S+$/.test(source ?? '')) throw new Error(`${where}: source must be an https URL`);
    if (!extrait?.trim() || !nom?.trim()) throw new Error(`${where}: name and exact excerpt are required`);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(verifieLe ?? '') || Number.isNaN(Date.parse(verifieLe))) throw new Error(`${where}: verifie_le must be YYYY-MM-DD`);
    const codes = secteurs === 'INCONNU' ? [] : (secteurs ?? '').split('|');
    if (codes.some(c => !(SECTOR_CODES as readonly string[]).includes(c)) || new Set(codes).size !== codes.length) throw new Error(`${where}: unknown or duplicate sector`);
    // Les règles de relecture : jamais « Retail » seul ; un INCONNU doit dire pourquoi.
    if (codes.length && codes.every(c => c === 'RETAIL')) throw new Error(`${where}: RETAIL alone is not a sector`);
    if (!codes.length && !remarque.trim()) throw new Error(`${where}: INCONNU needs a reason`);
    return { cle, nom, codes: [...codes].sort(), source, extrait, verifieLe, remarque };
  });
}

let cache: ReviewedSector[] | undefined;
export const loadReviewedSectors = () => (cache ??= parseReviewedSectors(readFileSync(PATH, 'utf8')));
