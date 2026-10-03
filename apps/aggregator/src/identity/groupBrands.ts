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
 * aujourd'hui aucune Maison à ces six groupes (mesuré le 03/10/2026 : 24 rattachements en base, tous Exemplar, OTB, SMCP,
 * URBN). Chaque entrée est relue : elle cite pourquoi la marque appartient au groupe, et en exclut les marques sous
 * licence (une montre Coach de Movado, un parfum YSL de L'Oréal ne sont pas la Maison Coach ou Saint Laurent) et les
 * marques cédées. `match` porte les graphies acceptées quand le nom seul piège (« Jordan » est aussi un pays et la ville
 * de West Jordan ; on n'accepte que « Jordan Brand » et « Air Jordan »).
 *
 * `owner` est le nom de la Maison au registre de la source (`Source.maison`, sans parenthèse) : si le registre change, la
 * liste ne s'applique plus (le groupe reste l'employeur par défaut, jamais une marque).
 */
export type GroupBrand = { name: string; match?: readonly string[] };
export type GroupBrandList = { group: string; owner: string; brands: readonly GroupBrand[];
  /** Entités juridiques du groupe dont le libellé ne dit rien de la marque (« VF Outdoor, LLC ») : la marque nommée l'emporte. */
  entities?: readonly string[] };

const LEVI_STRAUSS: Omit<GroupBrandList, 'owner'> = {
  group: 'Levi Strauss & Co.',
  // Beyond Yoga : magasins « Beyond Yoga … » sur le portail du groupe (73 offres le 02/10). Dockers est cédé (2025) : exclu.
  brands: [{ name: "Levi's" }, { name: 'Beyond Yoga' }],
};
const NIKE: Omit<GroupBrandList, 'owner'> = {
  group: 'Nike, Inc.',
  // Intitulés « Retail Associate, SEAS - Converse Jersey Shore » (31) et « … - Nike Glendale » (301) sur nke2, le 02/10.
  brands: [{ name: 'Nike' }, { name: 'Converse' }, { name: 'Jordan', match: ['Jordan Brand', 'Air Jordan'] }],
};
const VF: Omit<GroupBrandList, 'owner'> = {
  group: 'VF Corporation',
  // Chaque marque est publiée par le portail du groupe lui-même (intitulés « The North Face: Supervisor - … », « Vans: … »,
  // « Altra: Sales Lead - … », 02/10/2026). Supreme (2024) et Dickies (2025) sont cédées : exclues.
  brands: [{ name: 'The North Face', match: ['The North Face', 'North Face'] }, { name: 'Vans' }, { name: 'Timberland' },
    { name: 'Altra' }, { name: 'Smartwool' }, { name: 'Icebreaker' }, { name: 'JanSport' }, { name: 'Kipling' },
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
  group: 'Movado Group',
  // Marques détenues seulement ; les montres sous licence (Coach, Tommy Hilfiger, Hugo Boss, Lacoste, Calvin Klein) sont exclues.
  brands: [{ name: 'Movado' }, { name: 'MVMT' }, { name: 'Olivia Burton' }],
};
const L_OREAL: Omit<GroupBrandList, 'owner'> = {
  group: "L'Oréal",
  // Marques détenues ; les licences (YSL Beauté, Armani, Prada, Valentino, Ralph Lauren, Viktor&Rolf, Miu Miu, Maison Margiela,
  // Diesel) sont exclues : l'offre reste au groupe. « Matrix » est exclu (mot courant dans un intitulé).
  brands: [{ name: "L'Oréal Paris" }, { name: "L'Oréal Professionnel" }, { name: 'Garnier' }, { name: 'Maybelline', match: ['Maybelline'] },
    { name: 'NYX Professional Makeup', match: ['NYX Professional Makeup', 'NYX'] }, { name: 'Essie' }, { name: 'Lancôme' },
    { name: "Kiehl's" }, { name: 'Biotherm' }, { name: 'Helena Rubinstein' }, { name: 'Shu Uemura' }, { name: 'Urban Decay' },
    { name: 'IT Cosmetics' }, { name: 'Aesop' }, { name: 'Takami' }, { name: 'Youth To The People' }, { name: 'La Roche-Posay' },
    { name: 'Vichy' }, { name: 'CeraVe' }, { name: 'SkinCeuticals' }, { name: 'Kérastase' }, { name: 'Redken' }, { name: 'Pureology' },
    { name: 'Mugler' }, { name: 'Azzaro' }],
};

/** Clé de source → liste relue. Une source absente n'a pas de marque prouvable : ses offres sans enseigne vont au groupe. */
const BY_SOURCE: Readonly<Record<string, GroupBrandList>> = {
  levis: { ...LEVI_STRAUSS, owner: "Levi's" },
  nike: { ...NIKE, owner: 'Nike' },
  'nike-nke2': { ...NIKE, owner: 'Nike' },
  'vf-corporation': { ...VF, owner: 'VF Corporation' },
  movado: { ...MOVADO, owner: 'Movado' },
  'l-oreal-professionnel': { ...L_OREAL, owner: "L'Oréal" },
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

/** Les champs qui peuvent nommer l'enseigne : l'intitulé et le lieu (magasin compris), jamais la description. */
function namingFields(job: Pick<NormalizedJob, 'title' | 'location' | 'city' | 'raw'>): string[] {
  const raw = (job.raw ?? {}) as { title?: unknown; locationsText?: unknown; location?: unknown; bulletFields?: unknown; detail?: { jobPostingInfo?: { location?: unknown; additionalLocations?: unknown;
    jobRequisitionLocation?: { descriptor?: unknown } } } };
  const info = raw.detail?.jobPostingInfo;
  // Les champs natifs du RAW d'abord : le résolveur relit la même offre après nettoyage de l'intitulé et du lieu.
  const fields: unknown[] = [job.title, raw.title, job.location, job.city, raw.locationsText, raw.location, info?.location,
    info?.jobRequisitionLocation?.descriptor, ...(Array.isArray(raw.bulletFields) ? raw.bulletFields : []),
    ...(Array.isArray(info?.additionalLocations) ? info.additionalLocations : [])];
  return fields.filter((field): field is string => typeof field === 'string' && !!field.trim());
}

/**
 * La marque que l'offre nomme, s'il y en a exactement une dans la liste ; sinon rien (aucune, ou plusieurs : le groupe).
 * Correspondance par mots entiers : « Vans » ne se lit pas dans « Vansittart », ni « Nike » dans « Nikesha ».
 */
export function provenGroupBrand(job: Pick<NormalizedJob, 'title' | 'location' | 'city' | 'raw'>, list: GroupBrandList | undefined): GroupBrand | undefined {
  if (!list) return undefined;
  const fields = namingFields(job).map(field => ` ${brandText(field)} `);
  const named = list.brands.filter(brand => (brand.match ?? [brand.name]).some(spelling => {
    const words = brandText(spelling);
    return !!words && fields.some(field => field.includes(` ${words} `));
  }));
  return named.length === 1 ? named[0] : undefined;
}
