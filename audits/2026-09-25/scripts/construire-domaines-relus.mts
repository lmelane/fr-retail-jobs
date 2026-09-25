/**
 * LA LISTE RELUE DES DOMAINES À ÉCRIRE (logos manquants, 25/09/2026) — construite depuis les preuves mesurées.
 *
 * Entrées (produites en lecture seule) :
 *   - `audits/2026-09-25/domaines-essai-a-blanc.json` : les 150 premières sociétés sans domaine (ordre de
 *     `resolve-domains`), ce que la commande leur donnerait, les hôtes de candidature, la page d'accueil et le
 *     verdict du VRAI gestionnaire `/api/logo` pour chaque domaine candidat ;
 *   - `audits/2026-09-25/logos-societes-apres-correctif-api.json` : les sociétés publiées, leurs offres et leur
 *     domaine actuel (pour les corrections).
 *
 * La DÉCISION est ici, ligne par ligne, relue à la main : un domaine n'est retenu que si le nom de la société
 * porte la marque (ou que sa raison sociale est PROUVÉE être celle de la marque : mentions légales du site,
 * « d/b/a » publié, registre du commerce, liste des filiales déclarée, liens de candidature sur le domaine
 * carrière de la marque ; ou qu'il s'agit d'une ligne vendue sur le site même de la marque), que la preuve est directe (liens
 * de candidature sur le domaine de la Maison, tenant ATS de la Maison, site officiel vérifié, P856 Wikidata que la
 * commande retiendrait), et que la planche des logos servis a été regardée. Dans le doute, abstention motivée :
 * un logo d'une autre entreprise est pire qu'un monogramme. Contre-relecture adverse du 25/09 intégrée.
 *
 *   npx tsx audits/2026-09-25/scripts/construire-domaines-relus.mts
 * Sortie : `audits/2026-09-25/domaines-relus-logos.json`, lu par `apps/aggregator/scripts/ops/poser-domaines-relus.mts`.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import type { DomaineRelu, FichierRelu } from '../../../apps/aggregator/scripts/ops/domaines-relus.ts';

const dossier = new URL('../', import.meta.url);
type Resultat = { id: string; nom: string; publiables: number; publiablesFR: number; hotes: Record<string, number> | null;
  resolveDomains: { domain: string; domainSource: string } | null;
  verification: Record<string, { logo: number; accueil: { statut?: number; hoteFinal?: string; titre?: string | null; erreur?: string } }> };
const essai = JSON.parse(readFileSync(new URL('domaines-essai-a-blanc.json', dossier), 'utf8')) as { resultats: Resultat[] };
const mesure = JSON.parse(readFileSync(new URL('logos-societes-apres-correctif-api.json', dossier), 'utf8')) as
  { societes: Array<{ id: string; nom: string; domaine: string | null; offres: number; offresFR: number; etat: string }> };

/** Les domaines retenus pour une société SANS domaine : nom exact en base → domaine. */
const COMPLETER: Record<string, string> = {
  'Kate Spade': 'katespade.com', 'Neiman Marcus': 'neimanmarcus.com', 'Madewell Stores Madewell, Inc.': 'madewell.com',
  'United States of Aritzia Inc.': 'aritzia.com', 'Maje': 'maje.com', 'Lane Bryant': 'lanebryant.com', 'Ann Taylor': 'anntaylor.com',
  'Max Mara Fashion Group': 'maxmarafashiongroup.com', 'Claudie Pierlot': 'claudiepierlot.com', 'Diesel': 'diesel.com',
  'Bergdorf Goodman': 'bergdorfgoodman.com', 'Fursac': 'fursac.com', 'Naturalia': 'naturalia.fr', 'Canada Goose Inc.': 'canada-goose.com',
  'Canada Goose, US Inc.': 'canada-goose.com', 'Magazine zum Globus AG': 'globus.ch', 'SMCP': 'smcp.com',
  'THOMAS SABO GmbH & Co. KG': 'thomassabo.com', 'la fée maraboutée': 'lafeemaraboutee.fr', 'Aeropostale': 'aeropostale.com',
  'Marni': 'marni.com', 'Jil Sander': 'jilsander.com', 'Chantelle': 'chantelle.com', 'Icebreaker': 'icebreaker.com',
  'Abercrombie and Fitch Co.': 'abercrombie.com', 'Courir': 'courir.com', 'Ruinart': 'ruinart.com',
  'Corporate J. Crew Group, LLC': 'jcrew.com', 'Shiseido Americas Corporation': 'shiseido.com', 'Ephemera Group': 'ephemera-group.com',
  'TOTEME': 'toteme.com', 'The Dune Group': 'dunelondon.com', 'Bevilles External': 'bevilles.com.au',
  'Kastner &amp; Öhler Online Shop': 'kastner-oehler.at', 'Pegador®': 'pegador.com', 'Stanley/Stella BE': 'stanleystella.com',
  'Laverana GmbH & Co. KG - Hannover': 'laverana.com', 'Laverana GmbH & Co. KG - Bantorf': 'laverana.com',
  'HADDAD BRANDS EUROPE': 'haddad.com', 'Puig France': 'puig.com', 'LUSH | France': 'lush.com', 'Hindbag': 'hindbag.fr',
  'The Bradery': 'thebradery.com', 'Car & Classic': 'carandclassic.com', 'Beaumanoir': 'groupe-beaumanoir.com',
  'PEPCO Germany GmbH': 'pepco.eu', 'todsspa': 'tods.com', 'Link Theory (UK) Ltd.': 'theory.com',
  'LVMH Perfumes & Cosmetics': 'lvmh.com', 'LVMH Fragrance Brands': 'lvmh.com',
  'US02 Movado Retail Group, Inc.': 'movadogroup.com', 'US01 Movado Group, Inc.': 'movadogroup.com', 'NL01 Movado Group Nederland B.V.': 'movadogroup.com',
  'Advance Magazine Publishers Inc.': 'condenast.com', 'Advance Magazine Publishers Inc. HQ': 'condenast.com',
  '30000 The Condé Nast Publications Limited': 'condenast.com', '30080 Les Publications Condé Nast S.A.S.': 'condenast.com',
  'J. Choo Limited': 'jimmychoo.com', 'J Choo USA Inc': 'jimmychoo.com',
  'Gianni Versace S.r.l.': 'versace.com', 'Versace USA, Inc.': 'versace.com', 'Versace Canada': 'versace.com',
  'BRUNELLO CUCINELLI USA INC': 'brunellocucinelli.com',
  'Stella McCartney Limited': 'stellamccartney.com', 'Stella McCartney Italia S.r.l': 'stellamccartney.com', 'Stella McCartney (Japan) Limited': 'stellamccartney.com',
  'NIVEA India Pvt. Ltd.': 'nivea.com', 'NIVEA Polska Sp. z o.o.': 'nivea.com', 'NIVEA (Shanghai) Company Limited': 'nivea.com',
  'Anthro Weddings': 'anthropologie.com', 'ALTEX S.A.': 'altex.gr', 'HB Retail, Inc.': 'hugoboss.com',
  'Orlando Bathing Suit, LLC': 'everythingbutwater.com', 'FP Movement': 'freepeople.com', 'TSJ Holding GmbH': 'thomassabo.com',
  'MX01 MGI Distribucion S. de R.L. de C.V.': 'movadogroup.com', 'World Cat Vietnam Sourcing & Development Services Co. Ltd': 'puma.com',
};
/** Raisons sociales sans la marque dans le nom : la preuve qui les rattache, écrite telle quelle dans la ligne. */
const PREUVES: Record<string, { preuve: string; note: string }> = {
  'Advance Magazine Publishers Inc.': { preuve: 'https://www.condenast.com/user-agreement',
    note: 'raison sociale de Condé Nast (conditions d’utilisation : « Condé Nast … means Advance Magazine Publishers, Inc. ») ; offres du tenant Workday condenast.wd115' },
  'Advance Magazine Publishers Inc. HQ': { preuve: 'https://www.condenast.com/user-agreement',
    note: 'raison sociale de Condé Nast (conditions d’utilisation : « Condé Nast … means Advance Magazine Publishers, Inc. ») ; offres du tenant Workday condenast.wd115' },
  'FP Movement': { preuve: 'https://www.freepeople.com/fpmovement/',
    note: 'ligne d’activewear de Free People (URBN), vendue sur freepeople.com/fpmovement ; offres « FP Movement … » sur l’iCIMS d’URBN ; fpmovement.com refuse la connexion' },
  'TSJ Holding GmbH': { preuve: 'https://www.northdata.de/TSJ+Holding+GmbH,+Linz/237980x',
    note: 'registre du commerce autrichien (FN 237980x) : associée TS Unternehmens- und Beteiligungs GmbH, groupe Thomas Sabo ; offres du tenant Personio de THOMAS SABO' },
  'MX01 MGI Distribucion S. de R.L. de C.V.': { preuve: 'https://www.sec.gov/Archives/edgar/data/72573/000119312526115298/mov-ex21_1.htm',
    note: 'filiale mexicaine déclarée par Movado Group (Exhibit 21.1 du 10-K : « MGI Distribución, S de R.L. de C.V. ») ; offres du tenant Workday movadogroup' },
  'World Cat Vietnam Sourcing & Development Services Co. Ltd': { preuve: 'https://about.puma.com/en/newsroom/news/puma-opens-milestone-development-center-vietnam',
    note: 'PUMA : « PUMA’s sourcing organisation World Cat » ; offres du tenant Workday de PUMA' },
  'Orlando Bathing Suit, LLC': { preuve: 'https://www.everythingbutwater.com/legal-statement.html',
    note: 'mentions légales du site : « © Orlando Bathing Suit, LLC » ; offres du tenant Workday d’Everything But Water' },
  'HB Retail, Inc.': { preuve: 'https://careers.hugoboss.com/',
    note: 'entité de détail américaine de HUGO BOSS : ses offres (magasins BOSS) se postulent sur careers.hugoboss.com' },
  'ALTEX S.A.': { preuve: 'https://www.altex.gr/',
    note: 'Altex, « A Leading Fashion Retailer », propriétaire de FUNKY BUDDHA ; offres du tenant SmartRecruiters ALTEXSA de la source funky-buddha. altex.ro (proposé par Wikidata) est un distributeur roumain d’électronique : exclu' },
  'Anthro Weddings': { preuve: 'https://www.anthropologie.com/',
    note: 'offres « Anthropologie Weddings Stylist » sur l’iCIMS d’URBN ; ligne mariage vendue sur anthropologie.com' },
};
/** Familles d'entités juridiques d'une même Maison, publiées par SON tenant ATS : préfixe de nom → domaine. */
const FAMILLES: Array<[RegExp, string]> = [
  [/^(?:[0-9A-Z]{3,5} )?Swarovski\b/i, 'swarovski.com'],
  [/^PUMA\b/i, 'puma.com'],
  [/^NIKE\b/i, 'nike.com'],
  [/^Michael Kors\b/i, 'michaelkors.com'],
  [/^HUGO BOSS\b/i, 'hugoboss.com'],
  [/^UNIQLO\b/i, 'uniqlo.com'],
  [/^New Balance\b/i, 'newbalance.com'],
  [/^Beiersdorf\b/i, 'beiersdorf.com'],
];
/** Abstentions motivées : jamais écrites. */
const ABSTENTIONS: Record<string, string> = {
  'Reitmans (Canada) Ltée/Ltd': 'domaine de la société mère (reitmanscanadalimited.com) faiblement attesté, et ni lui ni reitmans.com ne servent un logo lisible : rien à gagner, un risque',
  'Moët Hennessy': 'moethennessy.com redirige vers lvmh.com : le logo serait celui de LVMH, actionnaire à 66 % seulement',
  'Saks OFF 5TH': 'saksoff5th.com affiche « Site Offline » et ne sert aucun logo ; saks.com est une autre enseigne',
  'Reclectic': 'concept de magasin d’URBN sans domaine propre identifié ; reclectic.com est un HOMONYME (boutique Shopify d’antiquités indépendante) : ne jamais l’utiliser',
  'EssilorLuxottica Demo': '« Demo » : libellé de démonstration, pas un employeur',
  'JUNE STORE': 'junestore.fr sert une page d’hébergeur par défaut',
};
/** Corrections d'un domaine posé faux : nom exact → [ancien, nouveau | null (retrait)], avec la preuve et le motif. */
const CORRIGER: Record<string, { ancien: string; nouveau: string | null; preuve: string; note: string }> = {
  'La casa de las Carcasas': { ancien: 'lacasadelascarcasas.es', nouveau: 'lacasadelascarcasas.com', preuve: 'https://lacasadelascarcasas.com/',
    note: 'le .es (P856 Wikidata) est exact mais inconnu des deux fournisseurs ; le .com est la passerelle internationale de la même Maison (« © La Casa de las Carcasas », choix España, Francia, Italia, Portugal, Mexico, Chile, Colombia) et sert son logo vert' },
  'Talbots': { ancien: 'talbots.co.jp', nouveau: 'talbots.com', preuve: 'https://www.talbots.com/',
    note: 'offres publiées par Knitwell Group (propriétaire de Talbots aux États-Unis) ; talbots.co.jp est Talbots Japon. Aucun des deux domaines ne sert de logo : correction de la donnée, sans effet visible' },
  'NOCIBE': { ancien: 'douglas.group', nouveau: 'nocibe.fr', preuve: 'https://www.nocibe.fr/',
    note: 'le logo affiché est celui du groupe Douglas (domaine du portail jobs.douglas.group/NOCIBE) ; nocibe.fr sert le logo NOCIBÉ' },
  'Donzé-Baume': { ancien: 'swatchgroup.com', nouveau: null,
    preuve: 'https://www.richemont.com/news-media/press-releases-news/richemont-acquires-watch-component-manufacturer-done-baume-sa/',
    note: 'filiale de Richemont depuis 2007 (offres du tenant Workday de Richemont, Les Breuleux) : le logo affiché est celui du Swatch Group, un concurrent. Aucun site propre joignable : retrait, monogramme' },
  // Six logos d'AUTRES entreprises affichés en production, tous posés par Wikidata (contre-relecture du 25/09,
  // chacun re-vérifié : image servie par le gestionnaire réel, sources et liens de candidature en base).
  'Petit Bateau': { ancien: 'petit-bateau.com', nouveau: 'petitbateau.com', preuve: 'https://www.petitbateau.com/',
    note: 'l’apex petit-bateau.com n’est pas le site (hébergeur OVHcloud) : les deux fournisseurs servent le logo d’OVHcloud, affiché sur 46 offres dont 39 en France. petitbateau.com redirige vers www.petit-bateau.com et sert le voilier Petit Bateau' },
  'TBS': { ancien: 'tbs.nl', nouveau: 'tbs.fr', preuve: 'https://www.tbs.fr/',
    note: 'tbs.nl est une société néerlandaise de drainage ; les offres viennent du groupe Eram, propriétaire de la marque de chaussures TBS (« Tbs - Chaussures & Vêtements Sportswear »)' },
  'Tekla': { ancien: 'tekla.com', nouveau: 'teklafabrics.com', preuve: 'https://job-boards.eu.greenhouse.io/tekla',
    note: 'tekla.com est le logiciel de construction de Trimble ; le tenant Greenhouse « tekla » publie les postes de Tekla Fabrics (Copenhague, boutique de Londres) ; teklafabrics.com « Tekla Fabrics »' },
  'TEVA': { ancien: 'tevapharm.com', nouveau: 'teva.com', preuve: 'https://www.deckers.com/brands',
    note: 'tevapharm.com est Teva Pharmaceutical ; les offres viennent du tenant Workday de Deckers (« … - Teva ») ; teva.com est le site de la marque et sert l’icône de son propre site (teva-eu.com/favicon.ico)' },
  'Wolf Lingerie': { ancien: 'wolf-lingerie.com', nouveau: 'wolflingerie.com', preuve: 'https://www.wolflingerie.com/',
    note: 'wolf-lingerie.com est une page d’hébergeur (logo OVHcloud) ; wolflingerie.com « Wolf Lingerie, spécialiste de la lingerie depuis 1947 », offres WTTJ de La Wantzenau' },
  'Blacks': { ancien: 'blackstone.com', nouveau: 'blacks.co.uk', preuve: 'https://www.blacks.co.uk/',
    note: 'blackstone.com est le fonds Blackstone ; le tenant Greenhouse « blacks » renvoie vers careers.jdplc.com, unité Blacks du groupe JD ; blacks.co.uk sert le logo Blacks' },
};

const domainePour = (nom: string) => COMPLETER[nom] ?? FAMILLES.find(([motif]) => motif.test(nom))?.[1] ?? null;
const lignes: Array<DomaineRelu & { note: string }> = [];
const abstentions: Array<{ id: string; nom: string; publiables: number; motif: string }> = [];
const nonDecides: string[] = [];
for (const r of essai.resultats) {
  if (ABSTENTIONS[r.nom]) { abstentions.push({ id: r.id, nom: r.nom, publiables: r.publiables, motif: ABSTENTIONS[r.nom] }); continue; }
  const domaine = domainePour(r.nom);
  if (!domaine) { nonDecides.push(r.nom); continue; }
  const v = r.verification[domaine];
  const hote = Object.keys(r.hotes ?? {}).find((h) => h === domaine || h.endsWith(`.${domaine}`));
  const preuves = [
    r.resolveDomains?.domain === domaine ? 'P856 Wikidata retenu par resolve-domains (essai à blanc)' : null,
    hote ? `liens de candidature sur ${hote}` : `offres publiées par ${Object.keys(r.hotes ?? {}).join(', ') || 'la source'}`,
    v?.accueil?.titre ? `accueil ${v.accueil.hoteFinal} « ${v.accueil.titre.slice(0, 60)} »` : null,
    `logo servi : ${v ? (v.logo === 200 ? 'oui' : 'non, monogramme maintenu') : 'vérifié sur la planche'}`,
  ].filter(Boolean).join(' · ');
  const special = PREUVES[r.nom];
  lignes.push({ id: r.id, nom: r.nom, domaine, ancienDomaine: null, preuve: special?.preuve ?? (hote ? `https://${hote}/` : `https://www.${domaine}/`),
    confiance: 'HAUTE', note: special ? `${special.note} · ${preuves}` : preuves });
}
for (const [nom, c] of Object.entries(CORRIGER)) {
  const s = mesure.societes.find((x) => x.nom === nom);
  if (!s) throw new Error(`société à corriger introuvable : ${nom}`);
  if (s.domaine !== c.ancien) throw new Error(`${nom} porte ${s.domaine}, pas ${c.ancien} : relire`);
  lignes.push({ id: s.id, nom, domaine: c.nouveau, ancienDomaine: c.ancien, preuve: c.preuve, confiance: 'HAUTE', note: c.note });
}
if (nonDecides.length) throw new Error(`sociétés sans décision : ${nonDecides.join(' | ')}`);

const fichier: FichierRelu & { abstentions: typeof abstentions } = {
  lot: 'logos-relu-2026-09-25',
  relecteur: 'Claude (audit logos du 25/09/2026), contre-relecture de Loïc avant --ecrire',
  reluLe: '2026-09-25',
  domaines: lignes,
  abstentions,
};
writeFileSync(new URL('domaines-relus-logos.json', dossier), `${JSON.stringify(fichier, null, 1)}\n`);

const offres = new Map(mesure.societes.map((s) => [s.id, s]));
const ecrits = lignes.filter((l) => l.ancienDomaine === null);
const avecLogo = ecrits.filter((l) => essai.resultats.find((r) => r.id === l.id)?.verification[l.domaine!]?.logo !== 404);
const somme = (xs: typeof lignes, cle: 'offres' | 'offresFR') => xs.reduce((n, l) => n + (offres.get(l.id)?.[cle] ?? 0), 0);
console.log(`lignes : ${lignes.length} (compléments ${ecrits.length}, corrections ${lignes.length - ecrits.length}) · abstentions : ${abstentions.length}`);
console.log(`compléments : ${somme(ecrits, 'offres')} offres publiées (FR ${somme(ecrits, 'offresFR')}) ; dont logo servi : ${avecLogo.length} sociétés, ${somme(avecLogo, 'offres')} offres (FR ${somme(avecLogo, 'offresFR')})`);
console.log(`abstentions : ${abstentions.reduce((n, a) => n + a.publiables, 0)} offres publiables`);
