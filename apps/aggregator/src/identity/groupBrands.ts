import type { NormalizedJob } from '../types.js';

/**
 * LES MARQUES PROUVÉES D'UN PORTAIL DE GROUPE RELU (R-142 §3, D-479 §2 ; arbitrage du CTO D-522 §6, 03/10/2026).
 *
 * Sur un portail relu MULTI_BRAND, l'offre qui nomme sa Maison la garde ; celle qui ne nomme pas son enseigne publie sous
 * le groupe. « Nommer » ne se devine pas : une offre nomme une Maison quand son INTITULÉ ou son LIEU (le magasin y figure)
 * porte, mot pour mot, le nom d'une marque de CETTE liste fermée — jamais une sous-chaîne, jamais une description (elle
 * cite souvent toutes les marques du groupe), jamais un nom hors liste. Deux marques nommées : l'offre reste au groupe.
 *
 * Pourquoi une liste versionnée ici et pas le registre : le mécanisme du registre (`Company.parentGroupId`) ne rattache
 * aujourd'hui aucune Maison à ces sept groupes (mesuré le 03/10/2026 : 24 rattachements en base, tous Exemplar, OTB, SMCP,
 * URBN). Chaque entrée est relue : elle cite pourquoi la marque appartient au groupe, et en exclut les marques sous
 * licence (une montre Coach de Movado, un parfum YSL de L'Oréal ne sont pas la Maison Coach ou Saint Laurent) et les
 * marques cédées. `match` porte les graphies acceptées quand le nom seul piège (« Jordan » est aussi un pays et la ville
 * de West Jordan ; on n'accepte que « Jordan Brand » et « Air Jordan »).
 *
 * `owner` est le nom de la Maison au registre de la source (`Source.maison`, sans parenthèse) : si le registre change, la
 * liste ne s'applique plus (le groupe reste l'employeur par défaut, jamais une marque).
 */
/**
 * `maison` : le nom sous lequel la Maison EXISTE déjà au registre (vu sur la source ou ailleurs), quand il diffère du nom
 * de la marque (« Maybelline NY ») ; le résolveur la cherche sous ce nom (`identity/existingMaison.ts`), et ne la crée
 * qu'en dernier recours. `titleOnly` : la marque est aussi un lieu (« Vichy », « Kipling Ave », « Converse, TX ») ; elle
 * n'est lue que dans l'intitulé ou la colonne de marque, jamais dans un lieu.
 */
export type GroupBrand = { name: string; match?: readonly string[]; maison?: string; titleOnly?: boolean };
export type GroupBrandList = {
  /** Le nom du groupe, sous lequel publie l'offre qui ne nomme pas son enseigne (sa Maison existante, sinon créée). */
  group: string; owner: string; brands: readonly GroupBrand[];
  /** Entités juridiques du groupe dont le libellé ne dit rien de la marque (« VF Outdoor, LLC ») : la marque nommée l'emporte. */
  entities?: readonly string[];
  /** Marques sous licence : un libellé natif qui les nomme publie sous le groupe, jamais sous la Maison homonyme (PRADA). */
  licences?: readonly string[];
  /** Marques du groupe hors périmètre Catwalks (décision CEO en attente) : leurs offres sont retenues, aucune Maison créée. */
  outOfPerimeter?: readonly string[];
};

const LEVI_STRAUSS: Omit<GroupBrandList, 'owner'> = {
  // Aucune Maison « Levi Strauss & Co. » au registre (03/10/2026) : créée sous sa clé à la première offre sans marque.
  group: 'Levi Strauss & Co.',
  // Beyond Yoga : magasins « Beyond Yoga … » sur le portail du groupe (73 offres le 02/10). Dockers est cédé (2025) : exclu.
  brands: [{ name: "Levi's" }, { name: 'Beyond Yoga' }],
};
const NIKE: Omit<GroupBrandList, 'owner'> = {
  // « Nike, Inc. » mène à la Maison NIKE : alias relu de la source `nike`, clé du registre NIKE (R-143 §5).
  group: 'Nike, Inc.',
  // Intitulés « Retail Associate, SEAS - Converse Jersey Shore » (31) et « … - Nike Glendale » (301) sur nke2, le 02/10.
  // « Converse » est aussi une ville (Texas, Indiana) : intitulé seulement.
  brands: [{ name: 'Nike' }, { name: 'Converse', titleOnly: true }, { name: 'Jordan', match: ['Jordan Brand', 'Air Jordan'] }],
};
const VF: Omit<GroupBrandList, 'owner'> = {
  group: 'VF Corporation',
  // Chaque marque est publiée par le portail du groupe lui-même (intitulés « The North Face: Supervisor - … », « Vans: … »,
  // « Altra: Sales Lead - … », 02/10/2026). Supreme (2024) et Dickies (2025) sont cédées : exclues. Kipling (Kipling Ave,
  // Toronto), Timberland et Altra (« altra », mot italien) : intitulé seulement.
  brands: [{ name: 'The North Face', match: ['The North Face', 'North Face'] }, { name: 'Vans' }, { name: 'Timberland', titleOnly: true },
    { name: 'Altra', titleOnly: true }, { name: 'Smartwool' }, { name: 'Icebreaker' }, { name: 'JanSport' }, { name: 'Kipling', titleOnly: true },
    { name: 'Eastpak' }, { name: 'Napapijri' }],
  // Entités du groupe lues sur le portail (`EmployerObservation`, au 03/10/2026), toutes rattachées à VF Corporation par
  // alias relu. « Icebreaker New Zealand Limited » n'y est pas : elle nomme sa marque, son alias mène déjà à Icebreaker.
  entities: ['VF Outdoor, LLC', 'VF Outdoor Canada, Co.', 'VF Services, LLC', 'VF Corporation', 'VF Northern Europe Services',
    'VF Northern Europe Services Ltd Ireland Branch', 'VF Northern Europe Ltd.', 'VF International S.a.g.l.', 'VF Apparel España SLU',
    'VF (J) France SAS', 'VF Germany Services GMBH', 'VF Italia Srl', 'VF Polska Distribution Sp zo o', 'VF Australia Pty Ltd',
    'VF New Zealand', 'VF Korea Limited Liability Company', 'VF Brands Malaysia Sdn Bhd', 'VF Singapore Overseas Services Pte. Ltd.',
    'VF China Limited Shanghai Branch', 'VF Shanghai Enterprise Company', 'VF Hong Kong Limited', 'VF Brands Taiwan Limited',
    'VF Taiwan Limited', 'VF Vietnam Sourcing Limited', 'VF (Cambodia) Sourcing Co., Ltd.', 'VF Asia Sourcing Limited, Bangladesh Liaison Office'],
};
const MOVADO: Omit<GroupBrandList, 'owner'> = {
  // La Maison « Movado Group » existe au registre (clé MOVADO_GROUP).
  group: 'Movado Group',
  // Marques détenues seulement ; les montres sous licence (Coach, Tommy Hilfiger, Hugo Boss, Lacoste, Calvin Klein) sont exclues.
  brands: [{ name: 'Movado' }, { name: 'MVMT' }, { name: 'Olivia Burton' }],
};
const L_OREAL: Omit<GroupBrandList, 'owner'> = {
  // « L'Oréal Groupe » porte 67 offres au registre (03/10/2026) ; la ligne GROUP « L'Oréal » n'en porte aucune.
  group: "L'Oréal Groupe",
  // Marques détenues, sous le nom de leur Maison existante (libellés natifs `dataLayer.jobBrand` du portail). Mugler et Azzaro :
  // seuls leurs parfums sont à L'Oréal, la Maison de mode est ailleurs, exclus. « Matrix » est exclu (mot courant). Vichy, Garnier,
  // Takami : aussi des lieux, intitulé seulement.
  brands: [{ name: "L'Oréal Paris" }, { name: "L'Oréal Professionnel" }, { name: 'Garnier', titleOnly: true },
    { name: 'Maybelline', match: ['Maybelline'], maison: 'Maybelline NY' },
    { name: 'NYX Professional Makeup', match: ['NYX Professional Makeup', 'NYX Prof. Make-up', 'NYX'], maison: 'NYX Prof. Make-up' },
    { name: 'Essie' }, { name: 'Lancôme' }, { name: "Kiehl's" }, { name: 'Biotherm' }, { name: 'Helena Rubinstein' }, { name: 'Shu Uemura' },
    { name: 'Urban Decay' }, { name: 'IT Cosmetics' }, { name: 'Aesop' }, { name: 'Takami', titleOnly: true }, { name: 'Youth To The People' },
    { name: 'La Roche-Posay' }, { name: 'Vichy', titleOnly: true }, { name: 'CeraVe' }, { name: 'SkinCeuticals' }, { name: 'Kérastase' },
    { name: 'Redken' }, { name: 'Pureology' }],
  licences: ['Prada', 'Prada Beauty', 'Prada Beauté', 'Yves Saint Laurent', 'YSL', 'YSL Beauty', 'Giorgio Armani', 'Armani', 'Valentino',
    'Ralph Lauren', 'Viktor&Rolf', 'Miu Miu', 'Maison Margiela', 'Diesel', 'Mugler', 'Azzaro'],
};
const PRADA: Omit<GroupBrandList, 'owner'> = {
  group: 'Prada Group',
  // Colonne « Brand » de la liste (`brandProperty: facility`, cassette du 03/10/2026) : Prada 125, Prada Group 50, Miu Miu 35,
  // Versace 13 (Maison au registre, au groupe depuis décembre 2025), Marchesi 1824 10, Church's 4, libellés japonais.
  brands: [{ name: 'Prada', match: ['Prada', 'プラダ'] }, { name: 'Miu Miu', match: ['Miu Miu', 'ミュウミュウ'] }, { name: "Church's" }, { name: 'Versace' }],
  entities: ['Prada Group', 'プラダ・グループ', 'Prada S.p.A.'],
  // Pâtisserie du groupe : périmètre soumis au CEO ; en attendant, retenue, et aucune Maison créée.
  outOfPerimeter: ['Marchesi 1824', 'Marchesi'],
};

/** Clé de source → liste relue. Une source absente n'a pas de marque prouvable : ses offres sans enseigne vont au groupe. */
const BY_SOURCE: Readonly<Record<string, GroupBrandList>> = {
  levis: { ...LEVI_STRAUSS, owner: "Levi's" },
  nike: { ...NIKE, owner: 'Nike' },
  'nike-nke2': { ...NIKE, owner: 'Nike' },
  'vf-corporation': { ...VF, owner: 'VF Corporation' },
  movado: { ...MOVADO, owner: 'Movado' },
  'l-oreal-professionnel': { ...L_OREAL, owner: "L'Oréal" },
  'prada-group': { ...PRADA, owner: 'Prada Group' },
};

/** Comparaison seulement : sans casse ni accents ni apostrophes, toute autre ponctuation devient une frontière de mot. */
export function brandText(value: string): string {
  return value.normalize('NFKD').replace(/\p{M}+/gu, '').replace(/['’`´]/gu, '').toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}

/** La liste relue de la source, si le registre la désigne toujours sous le même propriétaire. */
export function groupPortalBrands(sourceKey: string, registryMaison: string | null | undefined): GroupBrandList | undefined {
  const list = BY_SOURCE[sourceKey];
  const owner = registryMaison?.split('(')[0].trim();
  return list && owner && brandText(owner) === brandText(list.owner) ? list : undefined;
}

type Fields = { title: string[]; place: string[] };
const strings = (values: unknown[]) => values.filter((v): v is string => typeof v === 'string' && !!v.trim());

/**
 * Les champs qui peuvent nommer l'enseigne, jamais la description : l'INTITULÉ (et la colonne de marque d'une liste,
 * `listingBrand`, lue par un réglage relu) et le LIEU, magasin compris. Les champs natifs du RAW aussi : le résolveur
 * relit la même offre après nettoyage de l'intitulé et du lieu.
 */
function namingFields(job: Pick<NormalizedJob, 'title' | 'location' | 'city' | 'raw'>): Fields {
  const raw = (job.raw ?? {}) as { title?: unknown; locationsText?: unknown; location?: unknown; bulletFields?: unknown;
    listingBrand?: { value?: unknown }; detail?: { jobPostingInfo?: { location?: unknown; additionalLocations?: unknown;
    jobRequisitionLocation?: { descriptor?: unknown } } } };
  const info = raw.detail?.jobPostingInfo;
  return {
    title: strings([job.title, raw.title, raw.listingBrand?.value]),
    place: strings([job.location, job.city, raw.locationsText, raw.location, info?.location, info?.jobRequisitionLocation?.descriptor,
      ...(Array.isArray(raw.bulletFields) ? raw.bulletFields : []), ...(Array.isArray(info?.additionalLocations) ? info.additionalLocations : [])]),
  };
}

/** Les mots qui font d'un nom un LIEU dans un intitulé (« Usine de Vichy », « Store in Converse ») : la marque n'y est pas lue. */
const PLACE_WORDS = new Set('de du d a au en in at near usine site factory plant store boutique magasin'.split(' '));
/** Le nom du groupe et de ses entités ne nomme aucune marque (« Prada Group » ne dit pas « Prada ») : il est ôté avant lecture. */
const without = (field: string, phrases: readonly string[]) => phrases.reduce((text, phrase) => {
  const words = brandText(phrase);
  return words ? text.split(` ${words} `).join('  ') : text;
}, field);
const spelled = (fields: string[], spellings: readonly string[], placeName = false, ignored: readonly string[] = []) => {
  const padded = fields.map(field => without(` ${brandText(field)} `, ignored));
  return spellings.some(spelling => {
    const words = brandText(spelling);
    return !!words && padded.some(field => {
      for (let at = field.indexOf(` ${words} `); at >= 0; at = field.indexOf(` ${words} `, at + 1)) {
        const before = field.slice(0, at).trim().split(' ').pop() ?? '';
        if (!placeName || !PLACE_WORDS.has(before)) return true;
      }
      return false;
    });
  });
};
// Une marque homonyme d'un lieu (`titleOnly`) n'est lue que dans l'intitulé, et jamais après un mot de lieu.
const brandNamed = (fields: Fields, brand: GroupBrand, ignored: readonly string[]) =>
  spelled(brand.titleOnly ? fields.title : [...fields.title, ...fields.place], brand.match ?? [brand.name], brand.titleOnly, ignored);

/**
 * La marque que l'offre nomme, s'il y en a exactement une dans la liste ; sinon rien (aucune, ou plusieurs : le groupe).
 * Correspondance par mots entiers : « Vans » ne se lit pas dans « Vansittart », ni « Nike » dans « Nikesha ». Une marque
 * homonyme d'un lieu (`titleOnly`) ne se lit que dans l'intitulé.
 */
export function provenGroupBrand(job: Pick<NormalizedJob, 'title' | 'location' | 'city' | 'raw'>, list: GroupBrandList | undefined): GroupBrand | undefined {
  if (!list) return undefined;
  const fields = namingFields(job);
  const ignored = [list.group, ...(list.entities ?? [])];
  const named = list.brands.filter(brand => brandNamed(fields, brand, ignored));
  return named.length === 1 ? named[0] : undefined;
}

/** Une marque hors périmètre du groupe nommée par l'intitulé, la colonne de marque ou le libellé natif (`label`). */
export function outOfPerimeterBrand(job: Pick<NormalizedJob, 'title' | 'location' | 'city' | 'raw'>, list: GroupBrandList | undefined, label?: string): boolean {
  const names = list?.outOfPerimeter ?? [];
  return names.length > 0 && spelled([...namingFields(job).title, ...(label ? [label] : [])], names);
}

/** Le libellé natif est-il exactement (sans casse ni accents) l'un des noms de la liste ? */
export const labelIsOneOf = (label: string, names: readonly string[] | undefined) =>
  (names ?? []).some(name => brandText(name) === brandText(label));
