import countryLabels from '../../data/reference/country-labels.json' with { type: 'json' };
import { LABEL_TO_ISO } from './countryLabels.js';
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

/** Les valeurs d'un champ pays qui disent l'ABSENCE, pas un pays illisible (« N/A », « - », « null »). */
export const ABSENT_COUNTRY_VALUE = /^(undefined|null|n\/a|-)$/i;

export function normalizeCountry(raw?: string | null): string | undefined {
  if (!raw) return undefined;
  const text = raw.trim();
  if (!text || ABSENT_COUNTRY_VALUE.test(text)) return undefined;

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

  /*
   * LE CAS DES SUBDIVISIONS ÉTRANGÈRES HOMONYMES D'UN ÉTAT AMÉRICAIN.
   *
   * `TN` est le Tamil Nadu ET le Tennessee ; `MI` la province de Milan ET le
   * Michigan ; `MA` le Massachusetts ET Málaga.
   *
   * Périmètre mesuré le 14/09/2026 sur les subdivisions courantes : Inde
   * (TN, GA, OR), Italie (MI, PA, CA, CT), Espagne (MA, VA, CA, CO, AL).
   * L'Allemagne et le Canada n'ont AUCUNE subdivision homonyme.
   *
   * CE QUI FONCTIONNE DÉJÀ, SANS CODE SUPPLÉMENTAIRE. Quand le dernier segment
   * est un code pays qui n'est pas un État américain — `IT`, `ES` — la garde
   * ne mord pas, et le pays est rendu correctement :
   *
   *     « Milan, MI, IT »    → IT        « Malaga, MA, ES »    → ES
   *     « Mumbai, MH, IN »   → IN        « Louisville, KY, US » → US
   *
   * Une garde explicite a été écrite puis RETIRÉE pour ce cas : un balayage de
   * 1 682 combinaisons « Ville, SUB, PAYS » a montré qu'elle ne changeait
   * AUCUN résultat. C'était du code mort présenté comme une protection — le
   * défaut que ce fichier combat par ailleurs. Mesurer a évité de le graver.
   *
   * LIMITE CONNUE ET ASSUMÉE : quand le code PAYS est lui-même un État
   * américain, aucune lecture structurelle ne tranche.
   *
   *     « Chennai, TN, IN »  → abstention, alors que l'Inde serait correcte
   *     « Florence, KY, IN » → abstention, et c'est ici le bon résultat
   *
   * Les deux libellés ont la MÊME forme : trois segments dont deux codes qui
   * sont tous deux des États américains. Seul un référentiel des subdivisions
   * indiennes les distinguerait, et `SUBDIVISIONS` (geography.ts) ne couvre
   * aujourd'hui que US et CA. L'étendre est un chantier de données — le
   * registre partagé du lot 2 — pas un correctif de collision.
   *
   * En attendant, on s'abstient plutôt que d'inventer : une case vide se
   * répare, un pays faux ne se voit pas.
   */
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
  /*
   * UNE SEULE FONCTION PORTE LA GARDE, et elle ne dépend pas de la POSITION.
   *
   * Une constante `suspectUs` et une fonction `estIndecidable` ont existé ici,
   * limitées à la forme « Ville, XX » : elles comparaient le code au DERNIER
   * segment. Le troisième tour d'audit a prouvé par exécution, sur 488
   * libellés, qu'elles ne changeaient AUCUN résultat — cette fonction les
   * subsumait entièrement, et aucun des 16 témoins ne voyait leur suppression.
   *
   * C'était du code mort présenté comme une protection. Retiré plutôt que
   * conservé « au cas où » : deux gardes pour une décision, c'est une garde
   * dont personne ne sait laquelle tranche.
   */
  const estEtatUsAmbigu = (code: string, accompagnement: string): boolean => {
    const maj = code.trim().toUpperCase();
    /*
     * Le code doit être ACCOMPAGNÉ dans le libellé — un code seul (« MA »,
     * « KY ») reste un pays, faute de tout autre indice.
     *
     * Le critère ne peut pas être `segments.length >= 2` : « Florence (KY) »
     * est UN seul segment, et le premier tour d'audit a montré que cette forme
     * contournait la garde pour cette exacte raison.
     *
     * MAIS L'ACCOMPAGNEMENT SE MESURE SUR LE TEXTE, PAS SUR LA PONCTUATION.
     * Une version intermédiaire comparait le code au SEGMENT BRUT. Le second
     * tour d'audit l'a cassée : pour « (KY) », le segment vaut « (KY) », qui
     * diffère de « KY » — mais uniquement à cause des parenthèses, la syntaxe
     * de la branche elle-même. Idem pour « KY-402 » et son suffixe.
     *
     *     « KY »      → KY          (code seul, reste un pays)
     *     « (KY) »    → undefined   ← INCOHÉRENT : pas plus d'information
     *     « KY-402 »  → undefined   ← INCOHÉRENT
     *
     * L'appelant passe donc ce qui accompagne RÉELLEMENT le code, la syntaxe
     * de sa branche retirée : « Florence » pour « Florence (KY) », la chaîne
     * vide pour « (KY) ».
     */
    const accompagne = segments.length >= 2 || accompagnement.trim().length > 0;
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
      // Branche `direct` : le segment EST le code, rien ne l'accompagne en propre.
      if (estEtatUsAmbigu(segment, '')) return undefined;
      return direct;
    }
    const prefixed = segment.match(/^([A-Za-z]{2})-([A-Za-z0-9]{1,3})$/);
    if (prefixed) {
      // A city abbreviation such as ST-LO or St-Pie is not a country witness.
      // Leave it unresolved; a separate country field/name can still prove ST.
      if (prefixed[1].toUpperCase() === 'ST' && /^[A-Za-z]{2,}$/.test(prefixed[2])) continue;
      const code = normalizeCountry(prefixed[1]);
      if (code) {
        /*
         * « XX-YY » EST UN COUPLE PAYS-SUBDIVISION. LE PRÉFIXE PORTE LE PAYS.
         *
         * ── UNE RÈGLE PRÉCÉDENTE, ARBITRÉE FAUSSE PAR LE CEO ──────────────
         *
         * Pour réparer « KY-US » → Îles Caïmans, une version antérieure disait
         * « si le préfixe est un État américain ambigu, un suffixe reconnu
         * comme pays tranche ». Le CEO a produit les contre-exemples, et le
         * rejeu sur ce fichier les a confirmés le 14/09/2026 :
         *
         *     CA-NL → NL (Pays-Bas)      au lieu de CA — Terre-Neuve-et-Labrador
         *     DE-BY → BY (Biélorussie)   au lieu de DE — Bavière
         *     DE-BE → BE (Belgique)      au lieu de DE — Berlin
         *     IN-TN → TN (Tunisie)       au lieu de IN — Tamil Nadu
         *
         * La règle réparait le cas américain en CASSANT la convention ISO
         * qu'elle prétendait préserver. Dans un code de subdivision, le suffixe
         * ressemble souvent à un pays sans en être un — c'est précisément ce
         * qui rend la coïncidence trompeuse.
         *
         * ── LA RÈGLE RETENUE, ET SA LIMITE ASSUMÉE ────────────────────────
         *
         * ISO 3166-2 écrit `PAYS-SUBDIVISION`. Le préfixe porte donc le pays,
         * lorsque le segment désigne effectivement un code, sans collision
         * avec un nom de ville comme l'abréviation ST-LO contrôlée ci-dessus.
         *
         * « KY-US » n'est PAS traité ici. Le lire comme « Kentucky,
         * États-Unis » supposerait un format inversé que rien n'atteste dans
         * nos sources — le CEO : « une forme inversée peut être prise en
         * charge si le format de la source est établi ; elle ne justifie pas
         * une règle générale ». Le préfixe `KY` reste donc ambigu, et la garde
         * s'abstient plutôt que d'inventer.
         *
         * Valider le COUPLE (« CA-NL est-il une subdivision réelle du
         * Canada ? ») exigerait un référentiel par pays. `SUBDIVISIONS`
         * (geography.ts) ne couvre que US et CA : c'est le registre versionné
         * du lot 2. En attendant, la convention ISO suffit à ne pas inverser.
         */
        /*
         * Le suffixe ne DÉSIGNE jamais le pays. Un seul cas le rend NON
         * CONCLUANT : un suffixe qui dit littéralement « États-Unis » face à
         * un préfixe qui est un État américain homonyme d'un pays.
         *
         *     « KY-US » → abstention, et non KY (Îles Caïmans)
         *
         * Toute autre valeur de suffixe est laissée à la convention ISO : un
         * suffixe de subdivision (`CA-NL`, `DE-BY`) ou numérique (`KY-402`)
         * ne contredit rien, et le préfixe porte le pays. Élargir au-delà
         * casserait les couples ISO — c'est précisément ce que la version
         * précédente faisait.
         */
        const suffixeMaj = (prefixed[2] ?? '').toUpperCase();
        const suffixeDitEtatsUnis = suffixeMaj === 'US' || suffixeMaj === 'USA';
        if (estEtatUsAmbigu(prefixed[1], suffixeDitEtatsUnis ? suffixeMaj : '')) return undefined;
        return code;
      }
    }
    const parenthesised = segment.match(/\(([^)]+)\)\s*$/);
    if (parenthesised) {
      const code = normalizeCountry(parenthesised[1]);
      if (code) {
        // « Florence (KY) » → « Florence » ; « (KY) » → chaîne vide.
        if (estEtatUsAmbigu(parenthesised[1], segment.slice(0, segment.lastIndexOf('(')))) return undefined;
        return code;
      }
    }
  }
  return undefined;
}
