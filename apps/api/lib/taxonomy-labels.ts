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

const INCONNUS = {
  fr: ['Métier à préciser', 'Secteur à vérifier', 'Libellé indisponible'],
  en: ['Job category unspecified', 'Sector to verify', 'Label unavailable'],
  de: ['Beruf nicht angegeben', 'Branche zu prüfen', 'Bezeichnung nicht verfügbar'],
  it: ['Professione non specificata', 'Settore da verificare', 'Etichetta non disponibile'],
  nl: ['Functie niet vermeld', 'Sector te controleren', 'Benaming niet beschikbaar'],
  es: ['Profesión sin especificar', 'Sector por verificar', 'Etiqueta no disponible'],
  zh: ['职位类别未注明', '行业待核实', '暂无名称'],
};
export const libelleInconnu = (langue: LangueLibelles, type: 'metier' | 'secteur' | 'libelle') => INCONNUS[langue][type === 'metier' ? 0 : type === 'secteur' ? 1 : 2];
