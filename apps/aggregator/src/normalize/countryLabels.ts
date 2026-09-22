/**
 * LIBELLÉS DE PAYS → CODE ISO — données pures, aucune dépendance.
 *
 * Ce module existe pour une raison précise : `country.ts` importe `geography.ts`, donc
 * `geography.ts` ne peut pas importer `country.ts` en retour. Faute de ce partage, le champ pays
 * NATIF ne lisait qu'une table locale réduite, et toute source nommant son pays dans sa langue
 * perdait sa preuve géographique — mesuré le 2026-09-22 : 1 410 offres sur quatre marchés, dont
 * 578 pour le seul « Chinese Mainland » de LVMH.
 *
 * La table est donc ISOLÉE ici plutôt que recopiée : deux dictionnaires finissent toujours par
 * diverger, et c'est exactement ce qui a produit ce défaut.
 */
/**
 * Libellés (toutes langues rencontrées) -> code ISO.
 *
 * EXPORTÉE depuis le lot géographique du 2026-09-22 : `geography.ts` en a besoin pour le champ
 * pays NATIF, dont elle ne lisait qu'une table locale réduite — « Chinese Mainland » (LVMH, 578
 * offres), « Nederland », « Österreich » y perdaient toute preuve. Données pures, donc aucun
 * cycle ; partagée plutôt que recopiée, parce que deux dictionnaires finissent toujours par
 * diverger — c'est exactement ce qui a produit ce défaut.
 */
export const LABEL_TO_ISO: Record<string, string> = {
  'russian federation': 'RU', 'lao people\'s democratic republic': 'LA', laos: 'LA', 'syrian arab republic': 'SY', 'brunei darussalam': 'BN',
  france: 'FR', frankrijk: 'FR', frankreich: 'FR', francia: 'FR',
  'united states': 'US', 'united states of america': 'US', usa: 'US', 'u.s.a.': 'US',
  "états-unis d'amérique": 'US', 'etats-unis': 'US', 'états-unis': 'US',
  'united kingdom': 'GB', uk: 'GB', 'royaume-uni': 'GB', 'vereinigtes königreich': 'GB',
  'grande-bretagne': 'GB', angleterre: 'GB',
  germany: 'DE', allemagne: 'DE', deutschland: 'DE', duitsland: 'DE', alemania: 'DE',
  italy: 'IT', italie: 'IT', italia: 'IT', italien: 'IT',
  spain: 'ES', espagne: 'ES', españa: 'ES', espana: 'ES', spanje: 'ES', spanien: 'ES',
  netherlands: 'NL', 'pays-bas': 'NL', nederland: 'NL', niederlande: 'NL', 'países bajos': 'NL',
  belgium: 'BE', belgique: 'BE', belgië: 'BE', belgie: 'BE', belgien: 'BE',
  switzerland: 'CH', suisse: 'CH', schweiz: 'CH', svizzera: 'CH',
  canada: 'CA', portugal: 'PT', ireland: 'IE', irlande: 'IE',
  austria: 'AT', autriche: 'AT', österreich: 'AT', oesterreich: 'AT',
  poland: 'PL', pologne: 'PL', polska: 'PL',
  sweden: 'SE', suède: 'SE', suede: 'SE', sverige: 'SE',
  denmark: 'DK', danemark: 'DK', danmark: 'DK',
  norway: 'NO', norvège: 'NO', norvege: 'NO', norge: 'NO',
  finland: 'FI', finlande: 'FI', suomi: 'FI',
  greece: 'GR', grèce: 'GR', grece: 'GR',
  romania: 'RO', roumanie: 'RO', hungary: 'HU', hongrie: 'HU',
  'czech republic': 'CZ', tchéquie: 'CZ', tchequie: 'CZ', czechia: 'CZ',
  croatia: 'HR', croatie: 'HR', slovenia: 'SI', slovénie: 'SI', slovenie: 'SI',
  slovakia: 'SK', slovaquie: 'SK', lithuania: 'LT', lituanie: 'LT',
  luxembourg: 'LU', luxemburg: 'LU', monaco: 'MC', andorre: 'AD', andorra: 'AD',
  ukraine: 'UA', 'fédération de russie': 'RU', russia: 'RU', russie: 'RU',
  turkey: 'TR', turquie: 'TR', türkiye: 'TR', turkiye: 'TR',
  israel: 'IL', israël: 'IL',
  // Chine et ses régions administratives : rendues sous des libellés très
  // variables ("Chinese Mainland", "Mainland China", "Hong Kong S.A.R.").
  china: 'CN', chine: 'CN', 'chinese mainland': 'CN', 'mainland china': 'CN',
  'hong kong': 'HK', 'hong kong s.a.r.': 'HK', 'hong kong sar': 'HK', 'hong kong, ras chine': 'HK',
  macao: 'MO', 'macao s.a.r.': 'MO', 'macau sar': 'MO', 'macao, ras chine': 'MO',
  taiwan: 'TW', taïwan: 'TW', 'taiwan region': 'TW',
  japan: 'JP', japon: 'JP', korea: 'KR', 'south korea': 'KR', 'republic of korea': 'KR',
  'corée, république de': 'KR', 'corée du sud': 'KR', 'coree du sud': 'KR',
  singapore: 'SG', singapour: 'SG', malaysia: 'MY', malaisie: 'MY',
  thailand: 'TH', thaïlande: 'TH', thailande: 'TH',
  vietnam: 'VN', 'viet nam': 'VN', indonesia: 'ID', indonésie: 'ID', indonesie: 'ID',
  philippines: 'PH', india: 'IN', inde: 'IN', pakistan: 'PK', bangladesh: 'BD',
  cambodia: 'KH', cambodge: 'KH', maldives: 'MV',
  australia: 'AU', australie: 'AU', 'new zealand': 'NZ', 'nouvelle-zélande': 'NZ', 'nouvelle-zelande': 'NZ',
  brazil: 'BR', brésil: 'BR', bresil: 'BR', brasil: 'BR',
  mexico: 'MX', mexique: 'MX', méxico: 'MX',
  argentina: 'AR', argentine: 'AR', chile: 'CL', chili: 'CL',
  colombia: 'CO', colombie: 'CO', peru: 'PE', pérou: 'PE', perou: 'PE',
  uruguay: 'UY', panama: 'PA', 'dominican republic': 'DO', aruba: 'AW',
  'puerto rico': 'PR', 'porto rico': 'PR',
  'united arab emirates': 'AE', 'émirats arabes unis': 'AE', 'emirats arabes unis': 'AE',
  'saudi arabia': 'SA', 'arabie saoudite': 'SA', qatar: 'QA', kuwait: 'KW', koweït: 'KW',
  bahrain: 'BH', bahreïn: 'BH', lebanon: 'LB', liban: 'LB',
  'south africa': 'ZA', 'afrique du sud': 'ZA', egypt: 'EG', égypte: 'EG',
  tunisia: 'TN', tunisie: 'TN', morocco: 'MA', maroc: 'MA',
  seychelles: 'SC', namibia: 'NA', namibie: 'NA',
  guernsey: 'GG', guam: 'GU', 'saint-barthélemy': 'BL', 'saint-martin': 'MF',
  'virgin islands': 'VI', armenia: 'AM', arménie: 'AM', bulgaria: 'BG', bulgarie: 'BG',
  // Cas particulier : ce libellé Workday ne désigne pas un pays mais l'outre-mer
  // français. Le rattacher à FR est ce qu'attend un candidat qui filtre France.
  'french overseas departments and territories': 'FR',
};
