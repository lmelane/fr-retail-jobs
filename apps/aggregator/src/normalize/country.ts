/**
 * Pays canonique, en ISO-3166-1 alpha-2.
 *
 * Mesuré en prod le 2026-09-05 : **256 valeurs distinctes** pour ~90 pays
 * réels. La France seule s'écrivait `FR` (6 397), `France` (4 321), `fr`
 * (1 177) et `FRANCE` (73) — quatre lignes dans le filtre Pays, dont aucune ne
 * montrait plus du tiers des offres françaises. Les États-Unis avaient quatre
 * orthographes, l'Allemagne cinq (`DE`, `de`, `Allemagne`, `Deutschland`,
 * `Germany`, `Duitsland`).
 *
 * La cause : chaque adaptateur écrivait `country` tel que sa source le rend, et
 * rien ne normalisait à l'écriture. Un candidat qui filtre « France » voyait
 * 4 321 offres au lieu de ~11 900.
 *
 * On canonise vers le code ISO parce que c'est stable, court, et déjà ce que
 * les trois quarts des sources rendent ; l'affichage traduit ensuite le code
 * dans la langue du visiteur, ce qu'un libellé figé en base ne permet pas.
 */

/** Libellés (toutes langues rencontrées) -> code ISO. */
const LABEL_TO_ISO: Record<string, string> = {
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

/** Codes ISO-2 valides rencontrés, pour ne pas laisser passer n'importe quoi. */
/**
 * Tous les codes ISO 3166-1 alpha-2 connus d'Intl (280), pas une liste
 * blanche partielle : 208 offres en Lettonie, Serbie, Kosovo… étaient rejetées
 * comme « pas un pays » (audit A1, 2026-09-06).
 */
const ISO_CODES = new Set([
  // Régions Intl qui ne sont pas des pays (EU, UN, ZZ…) retirées.
  ...Object.values(LABEL_TO_ISO),
  'AC','AD','AE','AF','AG','AI','AL','AM','AN','AO','AQ','AR','AS','AT','AU','AW','AX','AZ','BA','BB',
  'BD','BE','BF','BG','BH','BI','BJ','BL','BM','BN','BO','BQ','BR','BS','BT','BU','BV','BW','BY','BZ',
  'CA','CC','CD','CF','CG','CH','CI','CK','CL','CM','CN','CO','CP','CQ','CR','CS','CU','CV','CW','CX',
  'CY','CZ','DD','DE','DG','DJ','DK','DM','DO','DY','DZ','EA','EC','EE','EG','EH','ER','ES','ET',
  'FI','FJ','FK','FM','FO','FR','FX','GA','GB','GD','GE','GF','GG','GH','GI','GL','GM','GN','GP',
  'GQ','GR','GS','GT','GU','GW','GY','HK','HM','HN','HR','HT','HU','HV','IC','ID','IE','IL','IM','IN',
  'IO','IQ','IR','IS','IT','JE','JM','JO','JP','KE','KG','KH','KI','KM','KN','KP','KR','KW','KY','KZ',
  'LA','LB','LC','LI','LK','LR','LS','LT','LU','LV','LY','MA','MC','MD','ME','MF','MG','MH','MK','ML',
  'MM','MN','MO','MP','MQ','MR','MS','MT','MU','MV','MW','MX','MY','MZ','NA','NC','NE','NF','NG','NH',
  'NI','NL','NO','NP','NR','NU','NZ','OM','PA','PE','PF','PG','PH','PK','PL','PM','PN','PR','PS','PT',
  'PW','PY','QA','RE','RH','RO','RS','RU','RW','SA','SB','SC','SD','SE','SG','SH','SI','SJ','SK',
  'SL','SM','SN','SO','SR','SS','ST','SU','SV','SX','SY','SZ','TA','TC','TD','TF','TG','TH','TJ','TK',
  'TL','TM','TN','TO','TP','TR','TT','TV','TW','TZ','UA','UG','UK','UM','US','UY','UZ','VA','VC',
  'VD','VE','VG','VI','VN','VU','WF','WS','XK','YD','YE','YT','YU','ZA','ZM','ZR','ZW',
]);

/**
 * Le code ISO-2 d'un pays écrit dans n'importe quelle langue ou casse.
 *
 * Rend `undefined` plutôt qu'une valeur douteuse : un pays absent est honnête,
 * un mauvais pays envoie le candidat sur des offres qui ne le concernent pas.
 */
/** Libellés Intl (anglais + français) de chaque code, en minuscules → code. Calculé une fois. */
const INTL_LABELS: Map<string, string> = (() => {
  const map = new Map<string, string>();
  for (const locale of ["en", "fr"]) {
    let names: Intl.DisplayNames;
    try { names = new Intl.DisplayNames([locale], { type: "region" }); } catch { continue; }
    for (const code of ISO_CODES) {
      try {
        const label = names.of(code);
        if (label && label !== code) map.set(label.toLowerCase(), code);
      } catch { /* code sans libellé */ }
    }
  }
  return map;
})();

export function normalizeCountry(raw?: string | null): string | undefined {
  if (!raw) return undefined;
  const text = raw.trim();
  if (!text || /^(undefined|null|n\/a|-)$/i.test(text)) return undefined;

  // Déjà un code ISO-2, quelle que soit la casse.
  if (/^[a-z]{2}$/i.test(text)) {
    const code = text.toUpperCase();
    return ISO_CODES.has(code) ? code : undefined;
  }

  const key = text.toLowerCase().replace(/\s+/g, ' ');
  if (LABEL_TO_ISO[key]) return LABEL_TO_ISO[key];

  // Libellé accentué écrit sans accents ("etats-unis", "coree du sud").
  const stripped = key.normalize('NFD').replace(/[̀-ͯ]/g, '');
  for (const [label, code] of Object.entries(LABEL_TO_ISO)) {
    if (label.normalize('NFD').replace(/[̀-ͯ]/g, '') === stripped) return code;
  }
  // Formes officielles longues et articles : « Korea, Republic of », « Netherlands,
  // The », « Russian Federation » (lot 2, 2026-09-06) — on relit la tête avant la
  // virgule, sans article, puis les libellés Intl anglais et français.
  const head = key.split(",")[0].replace(/^the /, "").replace(/ federation$| sar$| s\.a\.r\.$/, "").trim();
  if (head !== key && LABEL_TO_ISO[head]) return LABEL_TO_ISO[head];
  const viaIntl = INTL_LABELS.get(head) ?? INTL_LABELS.get(key);
  if (viaIntl) return viaIntl;
  return undefined;
}

/**
 * Le pays porté par un LIEU quand la source n'en donne pas.
 *
 * Mesuré en prod le 2026-09-06 (audit A1) : 14 074 offres actives sans pays,
 * dont 11 313 avec un lieu exploitable — « Columbus,US-OH,United States »,
 * « CH », « London, England, gb », Boots 100 % au Royaume-Uni. Le filtre Pays
 * ne les atteignait jamais. On lit le dernier segment, puis un préfixe
 * « US-OH », puis chaque segment ; jamais une devinette : sans pays reconnu,
 * undefined.
 */
export function countryFromLocation(location?: string | null): string | undefined {
  if (!location) return undefined;
  const segments = location.split(/[,|/·;]/).map((s) => s.trim()).filter(Boolean);
  for (const segment of [...segments].reverse()) {
    const direct = normalizeCountry(segment);
    if (direct) return direct;
    const prefixed = segment.match(/^([A-Za-z]{2})-[A-Za-z0-9]{1,3}$/);
    if (prefixed) {
      const code = normalizeCountry(prefixed[1]);
      if (code) return code;
    }
    const parenthesised = segment.match(/\(([^)]+)\)\s*$/);
    if (parenthesised) {
      const code = normalizeCountry(parenthesised[1]);
      if (code) return code;
    }
  }
  return undefined;
}
