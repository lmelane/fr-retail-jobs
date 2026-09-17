/**
 * Une offre du contrat catalogue v1, telle que le backend Catwalks la sert —
 * la forme JSON brute (grands entiers en chaînes), pas le type déjà lu.
 * Partagée par les témoins du lecteur, de la projection et du flux.
 */
export function offreBrute(surcharges: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    version: 1,
    id: 'cmoffre0001',
    slug: 'visual-merchandiser-paris',
    anciensSlugs: ['vm-paris'],
    titre: 'Visual Merchandiser',
    maison: { nom: 'Maison Témoin Directe', slug: 'maison-temoin-directe' },
    univers: ['MODE', 'LUXE'],
    specialisations: ['PRET_A_PORTER_ACCESSOIRES', 'MAROQUINERIE'],
    metier: { slug: 'visual-merchandiser', libelle: 'Visual Merchandiser' },
    contrat: 'CDI',
    tempsDeTravail: 'TEMPS_PLEIN',
    experience: 'CONFIRME',
    teletravail: 'OCCASIONAL',
    lieu: { libelle: 'Paris 8e, France', ville: 'Paris', arrondissement: '8e', codePostal: '75008', pays: 'FR', latitude: 48.87, longitude: 2.31 },
    salaire: { min: 38000, max: 45000, devise: 'EUR', texte: '38–45 k€' },
    description: {
      marque: 'Une Maison de mode.',
      poste: 'Au sein de la boutique, vous mettez en scène les collections et vous accompagnez les équipes de vente dans la mise en valeur des produits.',
      missions: 'Vous concevez les vitrines et les podiums, vous formez les équipes et vous assurez le suivi des directives visuelles pour chaque collection.',
      profil: 'Vous avez au moins trois ans d’expérience dans une Maison de mode, et vous êtes à l’aise avec les outils qui servent à planifier les implantations.',
      avantages: 'Tickets restaurant.',
    },
    visuel: 'https://media.example.com/visuel.jpg',
    publieeLe: '2026-09-10T08:00:00.000Z',
    finLe: null,
    modifieeLe: '2026-09-11T09:30:00.000Z',
    candidature: { type: 'CATWALKS', url: 'https://catwalks.io/offres/visual-merchandiser-paris' },
    ...surcharges,
  };
}

export function evenementPublie(seq: number | string, version: number | string, offre: Record<string, unknown> = offreBrute()) {
  return { seq: String(seq), version: String(version), evenement: 'PUBLIE', offre };
}

export function evenementRetire(seq: number | string, version: number | string, offreId: string) {
  return { seq: String(seq), version: String(version), evenement: 'RETIRE', offreId };
}

export function page(evenements: unknown[], suivant: string | null = evenements.length ? String((evenements[evenements.length - 1] as { seq: string }).seq) : null) {
  return { version: 1, evenements, suivant };
}
