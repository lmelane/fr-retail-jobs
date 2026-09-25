/**
 * LE PAYS QUE NOMMENT LES LIEUX DÉCLARÉS D'UNE PUBLICATION, CONFRONTÉ AU PAYS RETENU (D-440, D-442, D-450).
 *
 * ── LE DÉFAUT (D-440 point 1, mesuré le 24/09/2026 en production) ─────────────────────────────
 *
 * 12 offres Ulta publiées pour Cornelius (Caroline du Nord) et Indian Land (Caroline du Sud) étaient
 * classées à Porto Rico, avec le verdict `RAW_COUNTRY` : 16,9 % des 71 offres de ce marché. L'adaptateur
 * Jibe retient `country_code` (« PR »), le lecteur de faits lit `country` (« United States ») pour le même
 * lieu, et `retainedCountryOf` prenait le premier sans jamais regarder le second. Même forme chez Foot
 * Locker (Phenom) : `country_code` « US » pour une boutique de Slough déclarée « United Kingdom ». Et 6
 * offres Arc'teryx déclarées `CN` par Lever pour un lieu « Hong Kong » étaient servies au marché chinois,
 * alors que Hong Kong a le sien. Même forme, relevée le soir même hors de cette première mesure (qui ne lisait
 * ni le JSON-LD ni la ville) : 3 offres LuxExperience, lieu sans nom, ville « Hong Kong SAR, China »,
 * `addressCountry` « CN » (précision de D-442 du 24/09/2026). Et sous le champ `US` (D-450, « Porto Rico ») :
 * 28 offres classées aux États-Unis nomment Porto Rico, comme segment d'un nom de lieu, dans chacun de leurs
 * lieux (Skechers : région « Puerto Rico » et libellé ; Tapestry : libellé « San Juan, Puerto Rico, USA (…) » ; VF
 * Corporation : libellé hiérarchique « USCA > USA > Puerto Rico > … », D-454 §1), alors que Porto Rico a son
 * marché. D'autres offres de l'île restent aux États-Unis : voir `countriesNamedIn`.
 *
 * ── LES RÈGLES, DANS L'ORDRE OÙ ELLES S'APPLIQUENT ────────────────────────────────────────────
 *
 * 1. TERRITOIRE (D-442 §2, D-450). Si le champ pays désigne un pays englobant de la liste fermée
 *    `MARKET_TERRITORIES` (Hong Kong et Taïwan sous `CN`, Porto Rico sous `US`) et que CHAQUE lieu déclaré nomme
 *    explicitement, par son NOM, dans l'un de ses champs de nom de lieu (libellé, hiérarchique compris selon D-454 §1 ;
 *    ville ; région), un même
 *    territoire qui a son propre marché et que CE pays englobe, sans que les gardes du lieu entier l'écartent
 *    (`territoryNamedByPlace`), le territoire est retenu. Jamais sous un autre champ pays : le « Macau » que WTTJ
 *    déclare en Gironde sous `FR` reste français — et Macao, sans marché, n'est pas dans la liste. Jamais par un
 *    code (R-125 §4), même quand il désigne bien le territoire : l'abréviation postale « PR » d'une adresse
 *    américaine (« San Juan, PR 00925 ») laisse l'offre aux États-Unis.
 * 2. CONTRADICTION (D-440). Sinon, si tous les lieux déclarés nomment un même pays (`declaredPlacesCountry`)
 *    et que ce n'est pas le pays retenu, la publication se contredit :
 *    a. ADRESSE (D-442 §1) : si le pays retenu est celui d'un CODE pays (le champ pays de l'offre est un code
 *       à deux ou trois lettres) et que chaque lieu porte au moins TROIS champs d'adresse qui nomment l'autre
 *       pays (nom du pays, État de ce pays, code postal au format de ce pays, libellé) et aucun qui en nomme
 *       un troisième, le pays de l'adresse l'emporte sur le code ;
 *    b. ABSTENTION (D-435) : sinon, aucun pays n'est retenu ; l'offre reste servie par son lien, hors de
 *       tout marché. Une contradiction qui n'oppose pas l'adresse à un code (le pays retenu vient d'un nom ou
 *       d'un libellé) n'est pas tranchée par D-442 : elle reste une abstention.
 * 3. Sinon, le pays retenu par la chaîne reste celui de l'offre.
 *
 * ── CE QUI NE NOMME PAS UN PAYS, DÉLIBÉRÉMENT ─────────────────────────────────────────────────
 *
 *   · pour DÉTECTER la contradiction, un libellé d'un seul nom (« Hong Kong », « Macau », « Georgia ») :
 *     `resolveGeography` le lit comme une ville, et une ville seule ne produit jamais de pays ; ni la ville ni
 *     la région du lieu (la région ne compte ensuite que comme champ d'adresse de §1, par les seules tables
 *     US et CA). Seule la règle du territoire lit un nom de territoire dans ces champs, sous le champ du pays
 *     englobant (`CN`, `US`) et pour sa liste fermée ;
 *   · le repli des signaux français (`isFranceJob`) ;
 *   · les coordonnées : le code n'en a aucune lecture en pays. Ce sont elles, avec le code, que l'adresse
 *     contredit (Ulta : Carolina, Porto Rico ; Foot Locker : Caroline du Sud) ;
 *   · un code pays à deux ou trois lettres, pour le champ « nom du pays » : c'est le signal que l'adresse
 *     contredit, pas un champ d'adresse ;
 *   · un code postal ne nomme que les pays dont le format est connu ici (`POSTAL_CODE_FORMATS`), et
 *     seulement en faveur : un format inconnu ou différent ne contredit rien.
 */
import type { SourceFacts, SourceLocation } from '@catwalks/db/source-facts';
import { ABSENT_COUNTRY_VALUE, normalizeCountry } from './country.js';
import { resolveGeography, subdivisionCountryOf } from './geography.js';

type Place = Pick<SourceLocation, 'country' | 'label' | 'region' | 'postalCode'>;
/** Un lieu déclaré tel que la règle du territoire le lit : ses champs de nom de lieu, ville comprise. */
type DeclaredPlace = Place & Pick<SourceLocation, 'city'>;
type DeclaredPlaces = SourceFacts['locations'] | null | undefined;

/** Les lieux DÉCLARÉS de la publication, ou `undefined` : seules des valeurs déclarées témoignent. */
function declaredPlaces(locations: DeclaredPlaces): DeclaredPlace[] | undefined {
  return locations?.status === 'DECLARED' && locations.value?.length ? locations.value : undefined;
}

/** Le pays que nomme UN lieu déclaré, ou `undefined` s'il n'en nomme aucun avec certitude. */
function countryNamedByPlace(place: Place): string | undefined {
  return normalizeCountry(place.country) ?? (place.label ? resolveGeography({ location: place.label }).countryCode : undefined);
}

/**
 * Le pays unique que nomment TOUS les lieux déclarés de la publication, ou `undefined` : lieux non
 * déclarés ou illisibles, un lieu sans pays lisible, ou des lieux de plusieurs pays.
 *
 * Un lieu nomme un pays par son CHAMP pays (`normalizeCountry`, code ou nom), à défaut par la STRUCTURE de
 * son libellé (`resolveGeography` seule, avec ses gardes de collision : « Berlin, DE » ne nomme rien).
 */
export function declaredPlacesCountry(locations: DeclaredPlaces): string | undefined {
  const places = declaredPlaces(locations);
  if (!places) return undefined;
  // Un lieu sans pays lisible entre dans l'ensemble comme une valeur à part (`undefined`) :
  // l'ensemble n'est alors plus un pays unique, ou n'en contient aucun.
  const countries = new Set(places.map(countryNamedByPlace));
  const [only] = countries;
  return countries.size === 1 ? only : undefined;
}

// ── D-442 §1 — L'ADRESSE ─────────────────────────────────────────────────────────────────────

/** Le seuil fixé par le CEO : trois champs d'adresse concordants au moins. */
export const ADDRESS_CONCORDANCE_THRESHOLD = 3;

/**
 * Les formats de code postal connus ici, liste FERMÉE aux deux pays que la mesure du 24/09/2026 exige.
 *
 * · `US` : ZIP à cinq chiffres, ou ZIP+4 (même forme que `POSTAL_FORMATS.US` côté API,
 *   `apps/api/lib/job-posting-schema.ts`). Porto Rico emploie aussi des ZIP américains (006xx à 009xx) : ce
 *   champ ne départage jamais les États-Unis de Porto Rico. Les autres non plus, quand la source écrit
 *   « United States » pour un lieu de l'île : sous un code « PR », « United States », « 00925 » et « San Juan, PR,
 *   United States » font trois champs concordants et placent le magasin aux États-Unis (question ouverte ;
 *   aucune offre dans ce cas le 24/09/2026, les 12 Ulta concernées étant bien en Caroline du Nord et du Sud).
 * · `GB` : code postal britannique (zone, district, secteur, unité). Les séparateurs sont ignorés avant la
 *   lecture : Foot Locker écrit « SL1--1BX » pour SL1 1BX. Sans espace ni tiret, la forme reste lisible,
 *   l'unité étant toujours « chiffre + deux lettres » en fin de code.
 *
 * Un format ne PROUVE pas un pays à lui seul (H-GEO-01 : `DE`, `US`, `ID`, `IL`, `MA` partagent cinq
 * chiffres). Il ne compte ici que comme UN champ parmi trois concordants au moins, et seulement en faveur
 * du pays que les autres champs nomment déjà.
 */
const POSTAL_CODE_FORMATS: Readonly<Record<string, (code: string) => boolean>> = {
  US: (code) => /^\d{5}(?:-\d{4})?$/.test(code.trim()),
  GB: (code) => /^[A-Z]{1,2}\d[A-Z\d]?\d[A-Z]{2}$/.test(code.toUpperCase().replace(/[\s-]+/g, '')),
};

/** Le code postal a-t-il le format de ce pays ? `false` quand le format du pays n'est pas connu ici. */
export function postalCodeFitsCountry(postalCode: string | null | undefined, country: string): boolean {
  return !!postalCode?.trim() && (POSTAL_CODE_FORMATS[country]?.(postalCode) ?? false);
}

/** Les quatre champs d'adresse que D-442 §1 compte. */
export type AddressField = 'COUNTRY_NAME' | 'REGION' | 'POSTAL_CODE' | 'LABEL';

/** Un code pays à deux ou trois lettres (« PR », « US », « UK », « USA »), par opposition à un nom. */
function isCountryCode(value: string | null | undefined): boolean {
  return /^[A-Za-z]{2,3}$/.test(value?.trim() ?? '');
}

/** Un nom de pays, pas un code : le code est le signal que l'adresse contredit. */
function countryNameOf(value: string | null | undefined): string | undefined {
  return value?.trim() && !isCountryCode(value) ? normalizeCountry(value) : undefined;
}

/**
 * Ce que disent les champs d'adresse d'UN lieu du pays `country` : ceux qui le nomment (`concordant`), et
 * ceux qui en nomment un autre (`dissident`). Un champ vide, ou qui ne nomme aucun pays, n'est ni l'un ni
 * l'autre.
 */
export function addressFieldsFor(place: Place, country: string): { concordant: AddressField[]; dissident: AddressField[] } {
  const concordant: AddressField[] = [], dissident: AddressField[] = [];
  const classify = (field: AddressField, named: string | undefined) => {
    if (named === country) concordant.push(field);
    else if (named) dissident.push(field);
  };
  classify('COUNTRY_NAME', countryNameOf(place.country));
  classify('REGION', subdivisionCountryOf(place.region));
  if (postalCodeFitsCountry(place.postalCode, country)) concordant.push('POSTAL_CODE');
  classify('LABEL', place.label ? resolveGeography({ location: place.label }).countryCode : undefined);
  return { concordant, dissident };
}

/** Chaque lieu porte-t-il au moins trois champs d'adresse qui nomment ce pays, et aucun qui en nomme un autre ? */
function addressConcordsOn(places: Place[], country: string): boolean {
  return places.every((place) => {
    const { concordant, dissident } = addressFieldsFor(place, country);
    return concordant.length >= ADDRESS_CONCORDANCE_THRESHOLD && dissident.length === 0;
  });
}

// ── D-442 §2 — LE TERRITOIRE ─────────────────────────────────────────────────────────────────

/**
 * Les territoires qui ont leur PROPRE marché (`packages/db/marches.ts`), avec le pays que le champ pays
 * d'une source peut désigner à leur place. Liste FERMÉE : Hong Kong et Taïwan sous `CN` (D-442), Porto Rico
 * sous `US` (D-450) sont des marchés ; Macao n'en est pas un et n'y figure donc pas. Un témoin exige que
 * chaque entrée et son pays englobant soient des marchés.
 *
 * L'APPARIEMENT EST LA GARDE : un territoire n'est retenu que sous le champ pays qui l'englobe ICI (vérifié lieu
 * par lieu dans `territoryNamedByPlace`). Porto Rico ne se lit que sous `US`, Hong Kong et Taïwan que sous `CN` ;
 * sous tout autre champ (`FR`, `MX`…), aucun territoire.
 */
export const MARKET_TERRITORIES: Readonly<Record<string, 'CN' | 'US'>> = { HK: 'CN', TW: 'CN', PR: 'US' };

/**
 * Les champs de NOM de lieu que garde le lecteur de faits (`facts/locations.ts`) et où un territoire peut être
 * nommé : le libellé (Arc'teryx, Lever : « Hong Kong »), la ville (LuxExperience, JSON-LD `addressLocality` :
 * « Hong Kong SAR, China », sans libellé) et la région (`addressRegion`, `state`). Le champ pays du lieu n'en
 * est pas : il garde son veto ci-dessous.
 *
 * LIMITE CONNUE, NON TRANCHÉE : un lieu qui ne nomme le territoire QUE dans son propre champ pays (« Hong Kong »
 * sous le champ `CN` de l'offre, sans libellé, ville ni région qui le nomment) n'entre pas dans cette règle ; il
 * tombe dans la contradiction, donc dans l'abstention. Le texte de D-442 ne dit pas si ce champ vaut « nommé
 * dans le lieu déclaré ». 0 offre publiable concernée dans l'instantané du 24/09/2026 (18:06 UTC) : la section B
 * du rejeu (`audits/2026-09-24/scripts/pays-signaux-contradictoires.mts`) ne compte aucune abstention.
 */
const PLACE_NAME_FIELDS = ['label', 'city', 'region'] as const;

/**
 * Les pays que nomme explicitement un champ de nom de lieu, segment par segment, par leur NOM (jamais par un
 * code à deux ou trois lettres : « PR », « PRI », « HK ») : « Kowloon, Hong Kong » nomme Hong Kong ; « Hong Kong »
 * ou « Puerto Rico » seul aussi, ici, parce que la règle ne lit ces noms que sous le champ de leur pays englobant.
 *
 * LIMITES DOCUMENTÉES (D-454) : un nom de boutique (« Outlet Puerto Rico Prime ») n'est pas un segment, et 1 offre
 * Puma reste aux États-Unis (instantané du 24/09/2026, 18:06 UTC). Restent aussi aux États-Unis, sans nommer Porto
 * Rico : 7 offres qui n'en portent que le code ou le code postal (« San Juan, PR 00918 », région « PR », « 00924 » ;
 * jamais par un code, R-125 §4), 21 qui ne nomment qu'un lieu de l'île (Barceloneta, Bayamón, Mayagüez, Montehiedra,
 * Las Catalinas, « Ponce, US ») et 5 « San Juan, US », homonyme d'une ville du Texas. Décompte rejouable : section
 * « B. Porto Rico sous US » de `audits/2026-09-24/scripts/pays-signaux-contradictoires.mts`.
 */
function countriesNamedIn(text: string | null | undefined, separateurs: RegExp = SEPARATEURS): Set<string> {
  const named = new Set<string>();
  for (const segment of segmentsOf(text, separateurs)) {
    const country = countryNameOf(segment);
    if (country) named.add(country);
  }
  return named;
}

/** Les séparateurs d'une ville ou d'une région : ceux de la lecture des libellés (`countryFromLocation`). */
const SEPARATEURS = /[,|/·;]/;

/**
 * Ceux d'un LIBELLÉ, qui peut être hiérarchique : plus le « > » (« USCA > USA > Puerto Rico > San Juan 5008 - KIP »,
 * Workday de VF Corporation), dont les niveaux nomment le territoire par son nom (D-454 §1, R-125 §4 : « un libellé
 * hiérarchique »). Ce « > » ne sert qu'à la règle du territoire, et au seul libellé : `countryFromLocation` et la
 * contradiction de D-440 ne le lisent pas, et il hiérarchise un lieu sans en énumérer (`enumeratedPlaces`).
 *
 * LIMITE CONNUE : la hiérarchie est crue telle quelle. « APAC > Hong Kong > Shenzhen » sous `CN`, ou « USCA > USA >
 * Puerto Rico > Miami 12 », passeraient au territoire, comme « Hong Kong, Shenzhen » (voir les gardes plus bas). Les
 * 903 lieux hiérarchiques de l'instantané du 24/09/2026 (VF Corporation, JanSport) ont tous la forme « RÉGION > PAYS >
 * État > boutique » : seuls les 7 de Porto Rico y changent de marché.
 */
const SEPARATEURS_LIBELLE = /[,|/·;>]/;

/** Les segments d'un nom de lieu, à ses séparateurs. */
function segmentsOf(text: string | null | undefined, separateurs: RegExp = SEPARATEURS): string[] {
  return (text ?? '').split(separateurs).map((segment) => segment.trim()).filter(Boolean);
}

/**
 * Les lieux qu'un même champ ÉNUMÈRE (« Shanghai / Hong Kong », « Orlando, FL | San Juan, Puerto Rico »), quand il
 * en énumère plusieurs ; sinon aucun. La virgule et le « > » hiérarchisent un lieu (ville, région, pays), ils n'en
 * énumèrent pas.
 */
function enumeratedPlaces(text: string): string[] {
  const places = text.split(/[|/·;]/).map((place) => place.trim()).filter(Boolean);
  return places.length > 1 ? places : [];
}

/**
 * Le territoire qu'un lieu nomme sous le champ pays `enclosing` de l'offre, ou `undefined`. Les champs de nom de
 * lieu forment ensemble le lieu : ils doivent nommer UN territoire que `enclosing` englobe dans la liste fermée
 * (l'appariement), et aucun autre pays que l'englobant ; le champ pays du lieu, s'il existe, dit l'englobant ou le
 * territoire. Deux gardes écartent ensuite un lieu qui n'est visiblement pas tout entier dans le territoire : un
 * lieu mixte ne passe pas au territoire (D-454 §2, R-125 §4), parce qu'un doute ne s'affecte jamais avec certitude :
 *   · un segment est une subdivision du pays englobant, par les seules tables US et CA : « Carolina, Puerto Rico »
 *     sous l'État « North Carolina » (l'erreur Ulta en miroir), « Miami, FL / Puerto Rico » ;
 *   · un champ énumère plusieurs lieux (« / », « | », « · », « ; ») dont un ne nomme pas le territoire :
 *     « Shanghai / Hong Kong », « Los Angeles / San Juan, Puerto Rico ».
 * Ce sont des HEURISTIQUES, sans répertoire de villes : elles ne voient ni une ville du pays englobant qui n'est pas une
 * subdivision (« Orlando, San Juan, Puerto Rico », « Hong Kong, Shenzhen »), ni une énumération par conjonction ou par
 * retour à la ligne (« Miami, FL and San Juan, Puerto Rico »), ni un code postal continental seul (28031 sans État),
 * et la première est inerte sous `CN` (aucune table de provinces). Aucune offre dans ces cas le 24/09/2026.
 * Un lieu écarté garde le verdict qu'il avait avant la règle du territoire : le pays retenu, ou l'abstention de D-440
 * quand ses lieux déclarés nomment un autre pays. Le prix assumé par D-454 §2 : « Florida, Puerto Rico » (commune de
 * l'île, homonyme d'un État) ne passe pas au territoire ; libellé seul, il s'abstient ; avec le pays « United States »
 * dans le lieu, il reste aux États-Unis. Conséquence du texte de R-125 §4 (« un lieu qui ne nomme pas le territoire »),
 * que D-454 n'a pas présentée au CEO comme telle : « Central | Hong Kong » reste en Chine. Aucune offre dans ce cas.
 */
function territoryNamedByPlace(place: DeclaredPlace, enclosing: string): string | undefined {
  const fieldValue = place.country?.trim();
  const inField = normalizeCountry(fieldValue);
  // Un champ pays du lieu rempli mais illisible (« MEX », « U.K. ») ne dit pas l'englobant : un doute, aucun territoire.
  // « N/A » ou « - » disent l'absence, comme pour `normalizeCountry`.
  if (fieldValue && !ABSENT_COUNTRY_VALUE.test(fieldValue) && !inField) return undefined;
  // Chaque champ de nom de lieu, avec ses séparateurs : le « > » hiérarchique ne se lit que dans le libellé (D-454 §1).
  const champs = PLACE_NAME_FIELDS.flatMap((field) => {
    const texte = place[field]?.trim();
    return texte ? [{ texte, separateurs: field === 'label' ? SEPARATEURS_LIBELLE : SEPARATEURS }] : [];
  });
  const named = new Set(champs.flatMap(({ texte, separateurs }) => [...countriesNamedIn(texte, separateurs)]));
  const others = [...named].filter((country) => country !== enclosing);
  const [territory] = others;
  if (others.length !== 1 || MARKET_TERRITORIES[territory] !== enclosing) return undefined;
  // Le champ pays du lieu, s'il existe, doit dire le pays englobant ou le territoire lui-même.
  if (inField && inField !== enclosing && inField !== territory) return undefined;
  // Un lieu mixte ne passe pas au territoire (D-454 §2) : aucune subdivision du pays englobant, et chaque lieu énuméré le nomme.
  if (champs.some(({ texte, separateurs }) => segmentsOf(texte, separateurs).some((segment) => subdivisionCountryOf(segment) === enclosing))) return undefined;
  if (champs.some(({ texte, separateurs }) => enumeratedPlaces(texte).some((listed) => !countriesNamedIn(listed, separateurs).has(territory)))) return undefined;
  return territory;
}

/** Le territoire que nomment TOUS les lieux déclarés sous le champ pays `enclosing`, ou `undefined`. */
function territoryOfPlaces(places: DeclaredPlace[], enclosing: string): string | undefined {
  const territories = new Set(places.map((place) => territoryNamedByPlace(place, enclosing)));
  const [only] = territories;
  return territories.size === 1 ? only : undefined;
}

// ── LE VERDICT ───────────────────────────────────────────────────────────────────────────────

export type DeclaredPlaceVerdict =
  /** Aucune règle ne s'applique : le pays retenu par la chaîne reste celui de l'offre. */
  | { basis: 'RETAINED'; countryCode: string | undefined }
  /** D-440 / D-435 : la publication se contredit sans adresse concordante ; aucun pays. */
  | { basis: 'ABSTAINED'; countryCode: undefined; declared: string }
  /** D-442 §1 : le pays de l'adresse. `countryName` : le nom du pays déclaré, quand chaque lieu en porte un. */
  | { basis: 'ADDRESS'; countryCode: string; countryName: string | null }
  /** D-442 §2 : le territoire qui a son marché, nommé dans un nom de lieu (libellé, ville, région), sous le champ pays englobant. */
  | { basis: 'TERRITORY'; countryCode: string };

/**
 * Le pays d'une publication une fois ses lieux déclarés confrontés au pays retenu par la chaîne.
 *
 * @param retained     le pays retenu par la chaîne (`retainedCountryOf`, publication/content.ts)
 * @param countryField le champ pays de l'offre, tel que l'adaptateur l'a lu (`candidate.country`) : code ou nom
 * @param locations    les lieux déclarés par le lecteur de faits qualifié de la source
 */
export function declaredPlaceVerdict(input: {
  retained: string | undefined;
  countryField: string | null | undefined;
  locations: DeclaredPlaces;
}): DeclaredPlaceVerdict {
  const { retained } = input;
  const places = declaredPlaces(input.locations);
  if (!places) return { basis: 'RETAINED', countryCode: retained };
  const field = normalizeCountry(input.countryField);

  // 1. D-442 §2, D-450 — le territoire, sous le champ pays de l'offre, qui doit l'englober (`CN` : Hong Kong, Taïwan ;
  //    `US` : Porto Rico). Sans champ pays, le pays retenu vient d'un libellé : la règle ne s'applique pas.
  if (retained && field === retained) {
    const territory = territoryOfPlaces(places, retained);
    if (territory) return { basis: 'TERRITORY', countryCode: territory };
  }

  // 2. D-440 — la contradiction entre le pays retenu et celui des lieux déclarés.
  const declared = declaredPlacesCountry(input.locations);
  if (!retained || !declared || declared === retained) return { basis: 'RETAINED', countryCode: retained };

  // 2a. D-442 §1 — l'adresse concordante l'emporte sur le CODE pays qui a produit le pays retenu.
  if (field === retained && isCountryCode(input.countryField) && addressConcordsOn(places, declared)) {
    const names = places.map((place) => (countryNameOf(place.country) === declared ? place.country!.trim() : null));
    return { basis: 'ADDRESS', countryCode: declared, countryName: names.every(Boolean) ? names[0] : null };
  }
  // 2b. D-435 — sinon, aucun pays certain.
  return { basis: 'ABSTAINED', countryCode: undefined, declared };
}
