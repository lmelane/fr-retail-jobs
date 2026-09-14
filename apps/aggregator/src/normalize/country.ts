import countryLabels from '../../data/reference/country-labels.json' with { type: 'json' };
import { COLLIDING_CODES, US_STATES } from './geography.js';
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
/**
 * Les codes qu'Intl expose mais qui ne sont PAS des pays ISO 3166-1 en vigueur :
 * codes « exceptionnellement réservés » (`UK`, `FX`, `EA`, `IC`, `AC`, `CP`,
 * `DG`, `TA`) et pays DISPARUS (`NH` Nouvelles-Hébrides, `SU` URSS, `YU`
 * Yougoslavie, `DD` RDA, `AN` Antilles néerlandaises, `ZR` Zaïre, `BU`, `CS`,
 * `DY`, `HV`, `RH`, `TP`, `VD`, `YD`, `PZ`, `NQ`, `WK`, `JT`, `MI`, `CT`).
 *
 * Les garder revient à accepter comme pays des codes qui sont, dans nos données,
 * des SUBDIVISIONS : mesuré le 2026-09-08 — 20 offres sous « UK » (le code
 * valide est `GB`, et la table de libellés le disait déjà) et 3 offres à Salem
 * et Lebanon sous « NH », qui sont dans le New Hampshire américain.
 */
const NON_ISO_CODES = new Set([
  'UK', 'FX', 'EA', 'IC', 'AC', 'CP', 'DG', 'TA',
  'NH', 'SU', 'YU', 'DD', 'AN', 'ZR', 'BU', 'CS', 'DY', 'HV', 'RH', 'TP', 'VD', 'YD',
]);

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
].filter((code) => !NON_ISO_CODES.has(code)));

/**
 * Le code ISO-2 d'un pays écrit dans n'importe quelle langue ou casse.
 *
 * Rend `undefined` plutôt qu'une valeur douteuse : un pays absent est honnête,
 * un mauvais pays envoie le candidat sur des offres qui ne le concernent pas.
 */
/** Libellés Intl (anglais + français) de chaque code, en minuscules → code. Calculé une fois. */
const INTL_LABELS = new Map<string, string>(Object.entries(countryLabels.legacyEnglishFrenchLabels));

export function normalizeCountry(raw?: string | null): string | undefined {
  if (!raw) return undefined;
  const text = raw.trim();
  if (!text || /^(undefined|null|n\/a|-)$/i.test(text)) return undefined;

  // Déjà un code ISO-2, quelle que soit la casse.
  if (/^[a-z]{2}$/i.test(text)) {
    const code = text.toUpperCase();
    if (ISO_CODES.has(code)) return code;
    /**
     * Un code non ISO peut tout de même DÉSIGNER un pays : « UK » est le
     * Royaume-Uni dans l'usage courant, et la table des libellés le sait. On la
     * consulte avant de renoncer — sinon `UK` et `GB` deviennent deux clés.
     * Un code disparu (`NH`, `SU`) n'y figure pas et reste refusé.
     */
    return LABEL_TO_ISO[text.toLowerCase()];
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
  // Frozen CLDR reference data: exact names only, with ambiguous labels
  // retained as multiple candidates rather than an arbitrary country choice.
  const matches = (countryLabels.labels as Record<string, string[]>)[key.normalize('NFC')];
  return matches?.length === 1 && ISO_CODES.has(matches[0]) ? matches[0] : undefined;
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
/** Les codes d'États américains, dérivés de la table partagée. */
const US_STATE_CODES = new Set(Object.keys(US_STATES));

export function countryFromLocation(location?: string | null): string | undefined {
  if (!location) return undefined;
  const segments = location.split(/[,|/·;]/).map((s) => s.trim()).filter(Boolean);

  /**
   * D-435 (14/09/2026) — LA GARDE DE COLLISION, QUI MANQUAIT ICI.
   *
   * Mesuré en production : 176 offres portaient un code d'ÉTAT AMÉRICAIN dans
   * le champ PAYS. Indianapolis en Inde, Florence aux Îles Caïmans, Richmond
   * au Vatican — et AUCUNE n'était signalée (`countryIntegrity` nul).
   *
   * CE QUI A RENDU CE DÉFAUT POSSIBLE. `geography.ts` porte une garde soignée
   * qui, faute de preuve indépendante, S'ABSTIENT — le bon comportement. Mais
   * `upsert.ts` appelle ENSUITE cette fonction en repli, et elle lisait le
   * dernier segment sans aucune garde : elle DÉFAISAIT l'abstention prudente
   * de la fonction précédente.
   *
   * **Une chaîne de résolution ne vaut que par son maillon le plus permissif.**
   *
   * CE QUE CETTE GARDE FAIT, ET NE FAIT PAS. Le CEO : « ne PAS remplacer
   * globalement MA, IN, IL, CA par des États américains ; ces codes peuvent
   * désigner autre chose dans une autre source ».
   *
   * Elle n'affirme donc JAMAIS « c'est un État ». Elle REFUSE DE CONCLURE
   * quand les deux conditions sont réunies : le libellé a la forme d'une
   * adresse (« Ville, XX ») ET le code collisionne avec un pays. Le pays sera
   * posé par une preuve indépendante — un champ déclaré, une géolocalisation —
   * ou il restera vide. Une case vide se répare ; un pays faux ne se voit pas.
   *
   * « Casablanca, Maroc », « Mumbai, India », « Paris, FR » ne sont pas
   * touchés : le nom en toutes lettres et les codes non collisionnants
   * passent comme avant.
   */
  /*
   * LA GARDE NE MORD QUE SUR UNE FORME D'ADRESSE AMÉRICAINE.
   *
   * Une première version testait « au moins deux segments », et cassait des
   * cas parfaitement justes : « Berlin, DE », « Amsterdam, NL »,
   * « Toronto, ON, CA » perdaient leur pays. Réparer les offres américaines
   * en cassant les allemandes et les néerlandaises n'est pas un correctif.
   *
   * Le signal qui distingue les deux : dans une adresse américaine, le code
   * suit IMMÉDIATEMENT un nom de ville (« Louisville, KY ») et n'est PAS
   * précédé d'un autre code de subdivision. « Munich, BY, de » porte déjà sa
   * subdivision (`BY`, Bavière) : le dernier segment est alors bien un pays.
   *
   * On exige donc TROIS conditions cumulatives pour s'abstenir :
   *  - le code collisionne avec un pays ;
   *  - il est aussi un code d'ÉTAT AMÉRICAIN ;
   *  - le libellé ne porte pas DÉJÀ une subdivision non américaine, laquelle
   *    prouverait que le dernier segment est un pays (voir plus bas).
   */
  const dernier = segments[segments.length - 1]?.toUpperCase() ?? '';
  const avantDernier = segments[segments.length - 2] ?? '';

  /*
   * CE QUI DISTINGUE « Louisville, KY » DE « Berlin, DE » — LA STRUCTURE DU
   * LIBELLÉ, JAMAIS UNE PRÉFÉRENCE ENTRE DEUX PAYS.
   *
   * Une version intermédiaire de cette garde portait une liste de « pays
   * majeurs prioritaires » (`DE`, `CA`, `IN`…) censés l'emporter sur l'État
   * homonyme. Elle était fausse sur deux plans, et le témoin l'a prouvé :
   *
   *  - elle ARBITRAIT sans mesure quel pays « compte le plus » — un jugement
   *    métier que rien n'autorisait à graver dans un normaliseur ;
   *  - elle contenait `IN`, ce qui a immédiatement ROUVERT « Indianapolis, IN »,
   *    l'un des six cas mesurés en production le 14/09/2026.
   *
   * Le signal fiable est ailleurs, et il est vérifiable : une adresse
   * américaine complète place son ÉTAT en avant-dernière position
   * (« Wilmington, DE, US »), tandis qu'un libellé étranger y place une
   * subdivision qui n'est PAS un État américain (« Munich, BY, de » →
   * Bavière ; « Toronto, ON, CA » → Ontario). Sur les 25 codes qui
   * collisionnent avec un pays, aucune subdivision allemande, canadienne ou
   * néerlandaise courante n'est homonyme d'un État américain.
   *
   * Donc : le dernier segment n'est tenu pour un État — et la fonction
   * s'abstient — QUE si rien dans le libellé ne le désigne déjà comme un pays.
   */
  const avantDernierMaj = avantDernier.trim().toUpperCase();

  /*
   * LA PREUVE DE SUBDIVISION EXIGE UN CODE À DEUX LETTRES, EXACTEMENT.
   *
   * Une première version testait `/^[A-Z]{2,3}$/`. C'était un trou béant, et
   * l'audit défensif du 14/09/2026 l'a démontré par exécution : `US_STATE_CODES`
   * ne contient QUE des codes à deux lettres (51 clés, toutes de longueur 2),
   * donc une abréviation informelle à trois lettres — `ARK`, `IND`, `KEN`,
   * `VIR`, `ILL`, `ORE` — satisfaisait la regex sans jamais pouvoir être
   * reconnue comme un État. `porteDejaUneSubdivision` passait à vrai À TORT et
   * annulait la garde entière.
   *
   * Conséquence mesurée : « Indianapolis, IND, IN » rendait de nouveau `IN`
   * (Inde). QUATRE des six cas de production étaient rouverts, et le témoin
   * restait vert parce qu'aucun de ses cas n'avait de troisième segment.
   */
  const porteDejaUneSubdivision =
    /^[A-Z]{2}$/.test(avantDernierMaj) && !US_STATE_CODES.has(avantDernierMaj);

  const suspectUs =
    segments.length >= 2 &&
    /^[A-Z]{2}$/.test(dernier) &&
    COLLIDING_CODES.has(dernier) &&
    US_STATE_CODES.has(dernier) &&
    !porteDejaUneSubdivision;

  /*
   * LA GARDE S'APPLIQUE AUX TROIS BRANCHES, PAS À UNE SEULE.
   *
   * Le même audit a montré que la garde n'était consultée que dans la branche
   * `direct`. Les deux autres la contournaient intégralement :
   *
   *     « Florence, KY-403 »  → KY (Îles Caïmans)   via `prefixed`
   *     « Florence (KY) »     → KY (Îles Caïmans)   via `parenthesised`
   *
   * Un correctif qui ne ferme qu'un chemin sur trois ne ferme rien : une
   * chaîne ne vaut que par son maillon le plus permissif — le défaut même que
   * ce fichier corrige. La garde vit donc dans UNE fonction, consultée
   * partout où un code est sur le point d'être accepté comme pays.
   *
   * Elle ne dépend plus de la POSITION du segment : « KY, Florence » place le
   * code en tête, et rendait « Îles Caïmans » parce que la comparaison portait
   * sur le dernier segment. Un code d'État reste un code d'État où qu'il soit.
   */
  const estIndecidable = (code: string): boolean =>
    suspectUs && code.trim().toUpperCase() === dernier;

  /*
   * Le cas « code d'État en tête » (« IN, Indianapolis ») : `suspectUs` ne
   * peut pas s'appliquer, puisqu'il décrit la forme « Ville, XX ». On le
   * traite par son propre critère — un code collisionnant ET État américain,
   * dans un libellé de plusieurs segments, sans subdivision étrangère pour
   * prouver le contraire, reste indécidable quelle que soit sa place.
   */
  const estEtatUsAmbigu = (code: string, contexte: string): boolean => {
    const maj = code.trim().toUpperCase();
    /*
     * Le code doit être ACCOMPAGNÉ dans le libellé — un code seul (« MA »,
     * « KY ») reste un pays, faute de tout autre indice.
     *
     * Le critère ne peut pas être `segments.length >= 2` : « Florence (KY) »
     * est UN seul segment, et l'audit a montré que cette forme contournait
     * la garde pour cette exact raison. Ce qui compte est que le code soit
     * accompagné de quelque chose d'autre DANS son propre segment ou dans le
     * libellé — une ville, typiquement.
     */
    const accompagne = segments.length >= 2 || contexte.trim().toUpperCase() !== maj;
    return (
      accompagne &&
      /^[A-Z]{2}$/.test(maj) &&
      COLLIDING_CODES.has(maj) &&
      US_STATE_CODES.has(maj) &&
      !porteDejaUneSubdivision
    );
  };

  for (const segment of [...segments].reverse()) {
    const direct = normalizeCountry(segment);
    if (direct) {
      // Indécidable sans preuve indépendante : on s'abstient, on n'invente
      // ni le pays étranger ni les États-Unis.
      if (estIndecidable(segment) || estEtatUsAmbigu(segment, segment)) return undefined;
      return direct;
    }
    const prefixed = segment.match(/^([A-Za-z]{2})-[A-Za-z0-9]{1,3}$/);
    if (prefixed) {
      const code = normalizeCountry(prefixed[1]);
      if (code) {
        if (estEtatUsAmbigu(prefixed[1], segment)) return undefined;
        return code;
      }
    }
    const parenthesised = segment.match(/\(([^)]+)\)\s*$/);
    if (parenthesised) {
      const code = normalizeCountry(parenthesised[1]);
      if (code) {
        if (estEtatUsAmbigu(parenthesised[1], segment)) return undefined;
        return code;
      }
    }
  }
  return undefined;
}
