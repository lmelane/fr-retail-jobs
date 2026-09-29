import type { OccupationManifest } from './occupation-engine.ts';
import { searchWords, type SearchConcept } from './search-intent.ts';

/** Search vocabulary, separate from catalogue classification and publication.
 * These phrases describe the same activity; they never rewrite a native title,
 * activate an occupation release, or turn a neighbouring role into a synonym.
 * Reviewed against S1 native descriptions; see the dated benchmark findings. */
export const SEARCH_VOCABULARY_VERSION = '20260924-v2';
/** Alias historiques de l'API. Un manifeste qui déclare `searchVocabularyVersion` les porte déjà (versés par la passe
 * de curation v3, lot 2B de D-475) : l'API ne les ajoute qu'à la version servie v1. Retirés au sous-lot 2F. */
export const ROLE_ALIASES: Readonly<Record<string, readonly string[]>> = {
  'assistant-store-manager': ['Assistant Store Director', 'Deputy Store Director', 'Assistant Boutique Director', 'Deputy Boutique Director'],
  'product-developer': ['Footwear Developer', 'Apparel Developer', 'Accessories Developer', 'Développeur chaussures', 'Développeur accessoires'],
  'financial-controller': ['Financial Control', 'Contrôle de gestion', 'Controlling'],
  watchmaker: ['Watch Technician', 'Watch Repair Technician', 'Technicien horloger', 'Technicienne horlogère'],
};
// Broad family labels are search intentions, not 27 mutually exclusive job gates.
export const FAMILY_ALIASES: Readonly<Record<string, readonly string[]>> = {
  'retail-client-advisor': ['Sales advisory', 'Retail sales'],
  'beauty-advisor': ['Beauty advice', 'Beauty consulting'],
  'retail-store-management': ['Store management', 'Retail management', 'Direction boutique'],
  'retail-area-management': ['Regional retail management', 'Area retail management'],
  'retail-operations': ['Store operations', 'Retail operations'],
  'visual-merchandising': ['Visual merchandising'],
  'merchandising-buying': ['Merchandising and buying', 'Achats', 'Buying'],
  'wholesale-b2b': ['Wholesale and B2B', 'Wholesale'],
  'crm-clienteling': ['CRM and clienteling', 'Clienteling'],
  'ecommerce-digital': ['Ecommerce and digital', 'E commerce'],
  'marketing-communication': ['Marketing and communication', 'Marketing communications'],
  'design-creation': ['Creation and design', 'Creative design'],
  'product-development-rd': ['Product development and R&D', 'Research and development', 'Recherche et développement'],
  'atelier-craft': ['Workshop and craftsmanship', 'Artisanat', 'Métiers d’art', 'Craftsmanship'],
  'manufacturing-quality': ['Manufacturing and quality', 'Production and quality'],
  'supply-chain-logistics': ['Supply chain and logistics', 'Logistique', 'Logistics'],
  finance: ['Finance'],
  'hr-talent': ['Human resources', 'Ressources humaines', 'RH'],
  'it-data': ['IT and data', 'Informatique'],
  'legal-compliance': ['Legal and compliance', 'Juridique'],
  'strategy-management': ['Strategy and leadership', 'Corporate strategy', 'Stratégie générale'],
  sustainability: ['Sustainability', 'Sustainable development', 'RSE'],
  'customer-service': ['Customer service', 'Service après vente'],
  hospitality: ['Hotels and restaurants', 'Hotel and restaurant', 'Hospitality'],
  'admin-facilities': ['Administration and facilities', 'Services généraux'],
  'health-optical-services': ['Health pharmacy optical', 'Santé pharmacie optique'],
  'beauty-services': ['Hair and beauty services', 'Coiffure prestations beauté'],
};

export function searchConcepts(manifest: OccupationManifest, sectors: { code: string; labels: Record<string, string> }[]): SearchConcept[] {
  // Une seule source de vocabulaire, versionnée avec le manifeste quand il la porte ; la v1 servie reste inchangée.
  const historique = !manifest.searchVocabularyVersion;
  const roles: SearchConcept[] = manifest.occupations.map(o => {
    const titreSeul = historique ? (o.key === 'financial-controller' ? ROLE_ALIASES[o.key] : undefined) : o.titleOnlyAliases;
    return { key: o.key, kind: 'role',
      aliases: [...new Set([...Object.values(o.labels), ...(o.aliases ?? []), ...(historique ? ROLE_ALIASES[o.key] ?? [] : [])])],
      ...(titreSeul?.length ? { titleOnlyAliases: titreSeul } : {}) };
  });
  const families: SearchConcept[] = manifest.families.map(f => {
    const aliases = [...Object.values(f.labels), ...(historique ? FAMILY_ALIASES[f.key] ?? [] : f.aliases ?? [])];
    // Optional conjunctions in an enumerated family label, never globally
    // discarded words in user input or inferred employer identities.
    const withoutConjunction = aliases.map(a => searchWords(a).filter(w => !['and', 'et'].includes(w)).join(' '));
    return { key: f.key, kind: 'family', aliases: [...new Set([...aliases, ...withoutConjunction])] };
  });
  return [...roles, ...families, ...sectors.map(s => ({ key: s.code, kind: 'sector' as const, aliases: Object.values(s.labels) }))];
}
