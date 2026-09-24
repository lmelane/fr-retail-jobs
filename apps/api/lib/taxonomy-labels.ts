import inconnus from "./data/unknown-labels.json";
import catalogue from './data/taxonomy-labels.json';
import type { LangueLibelles } from '@catwalks/db/presentation';

/** Traductions de présentation, indépendantes de la révision des règles de classification.
 * Un concept nouveau ou renommé conserve son libellé natif tant que sa traduction n'existe pas. */
export function libelleConcept(kind: 'occupations' | 'sectors', key: string, labels: Record<string, string>, langue: LangueLibelles): string {
  if (labels[langue]) return labels[langue];
  const entries = catalogue[kind] as Record<string, { sourceEn: string; labels: Record<string, string> }>;
  const entree = entries[key];
  return (entree?.sourceEn === labels.en ? entree.labels[langue] : undefined) ?? labels.en ?? labels.fr ?? key;
}

export const libelleInconnu = (langue: LangueLibelles, type: 'metier' | 'secteur' | 'libelle') => inconnus[langue][type];
