import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { NormalizedJob } from '../types.js';
import { groupPortalBrands, provenGroupBrand } from './groupBrands.js';
import { employerFromCertifiedScope, isPortalEmployerOrigin, isGroupBrandOrigin, GROUP_BRAND_PATH, GROUP_BRAND_RULE, CERTIFIED_SCOPE_PATH,
  GROUP_SCOPE_RULE, GROUP_LICENCE_RULE, GROUP_OUT_OF_PERIMETER_HOLD } from './portalEmployer.js';
import { isNativeOrigin } from './ordinaryIdentity.js';
import { spontaneousApplicationProof } from '../pipeline/spontaneousApplication.js';
import { publicationDisposition, retentionClass } from '../pipeline/publicationDisposition.js';

/**
 * D-522 §6 — R-142 §3 SUR LES PORTAILS WORKDAY MULTI-MARQUES. Avant ce lot, `employerFromCertifiedScope` ne levait la
 * retenue « employeur absent » que sur un portail SINGLE_BRAND : 2 245 annonces retenues au RUN du 02/10/2026, dont
 * 1 295 Levi's, 485 VF, 333 Nike (nke2). Les offres de ce fichier sont des sorties scellées réelles de ce RUN, réduites
 * aux champs lus (lot d'ingestion, `audits/2026-10-03/stock-exceptions/workday-marques/`).
 */
type Fixture = Record<string, NormalizedJob & { source: string }>;
const real: Fixture = JSON.parse(readFileSync(new URL('./__fixtures__/group-brands-20261002.json', import.meta.url), 'utf8'));
const portal = (source: string) => {
  const owner = { levis: "Levi's", 'nike-nke2': 'Nike', 'vf-corporation': 'VF Corporation', movado: 'Movado', 'l-oreal-professionnel': "L'Oréal (toutes Maisons)",
    'prada-group': 'Prada Group' }[source]!;
  return { owner, brands: groupPortalBrands(source, owner) };
};
const lift = (job: NormalizedJob & { source: string }, scope: 'SINGLE_BRAND' | 'MULTI_BRAND' | null = 'MULTI_BRAND') => {
  const { owner, brands } = portal(job.source);
  return employerFromCertifiedScope(job, owner, scope, brands);
};
const brandOf = (job: NormalizedJob) => job.employerEvidence?.path === GROUP_BRAND_PATH ? job.employerEvidence.rawName : undefined;

describe('prémisses : les offres réelles atteignent le défaut', () => {
  it('chaque offre Workday du jeu est retenue faute d’employeur, sans employeur nommé', () => {
    for (const key of ['beyondYoga', 'levisStoreCode', 'converseTitle', 'westJordan', 'twoBrands', 'vfNoBrand', 'movadoClerk', 'brunelloCv']) {
      expect(real[key].publicationHold, key).toBe('WORKDAY_EMPLOYER_ABSENT_IN_DETAIL');
      expect(real[key].company ?? real[key].employerEvidence, key).toBeUndefined();
    }
  });
  it('l’offre aux deux marques nomme vraiment JanSport ET Eastpak ; West Jordan est une ville', () => {
    expect(real.twoBrands.title).toMatch(/Jansport\/Eastpak/);
    expect(real.westJordan.title).toMatch(/Nike West Jordan/);
  });
});

describe('portail relu MULTI_BRAND : la marque prouvée, sinon le groupe (R-142 §3)', () => {
  it('marque prouvée par l’intitulé : Beyond Yoga sur le portail Levi Strauss, Converse sur celui de Nike', () => {
    for (const [key, brand] of [['beyondYoga', 'Beyond Yoga'], ['converseTitle', 'Converse']] as const) {
      const job = lift(real[key]);
      expect(job.publicationHold, key).toBeUndefined();
      expect(job.employerEvidence, key).toEqual({ rawName: brand, path: GROUP_BRAND_PATH, rule: GROUP_BRAND_RULE, role: 'BRAND' });
      // La marque est aussi `company` : l'ingestion en déduit le domaine de la Maison, jamais celui du groupe.
      expect(job.company, key).toBe(brand);
    }
  });
  it('groupe par défaut : l’offre qui ne nomme aucune marque publie sous le NOM DU GROUPE de la liste, pas sous la Maison du registre', () => {
    for (const [key, group] of [['levisStoreCode', 'Levi Strauss & Co.'], ['vfNoBrand', 'VF Corporation'], ['movadoClerk', 'Movado Group']] as const) {
      const job = lift(real[key]);
      expect(job.publicationHold, key).toBeUndefined();
      expect(job.employerEvidence, key).toEqual({ rawName: group, path: CERTIFIED_SCOPE_PATH, rule: GROUP_SCOPE_RULE, role: 'GROUP' });
    }
    // Prémisse : la Maison au registre de la source n'est pas le groupe (« Levi's », « Movado »).
    expect(portal('levis').owner).toBe("Levi's"); expect(portal('movado').owner).toBe('Movado');
  });
  it('deux marques du groupe nommées : le groupe, jamais l’une des deux', () => {
    const job = lift(real.twoBrands);
    expect(brandOf(job)).toBeUndefined();
    expect(job.employerEvidence?.rule).toBe(GROUP_SCOPE_RULE);
  });
  it('marque hors liste : jamais une autre Maison (une montre Coach de Movado reste au groupe)', () => {
    const job = lift({ ...real.movadoClerk, title: 'Coach Watches Sales Associate', raw: { ...(real.movadoClerk.raw as object), title: 'Coach Watches Sales Associate' } });
    expect(brandOf(job)).toBeUndefined();
    expect(job.employerEvidence?.rawName).toBe('Movado Group');
  });
  it('sous-chaîne piège : « Vansittart », « Nikesha », « Conversely » ne nomment aucune marque ; West Jordan n’est pas Jordan', () => {
    const traps = ['Store Manager - Vansittart Road', 'Nikesha Team Lead', 'Conversely, Analyst', 'Timberlands Grounds Keeper'];
    for (const title of traps) {
      const job = { ...real.vfNoBrand, title, raw: { ...(real.vfNoBrand.raw as object), title } } as NormalizedJob;
      expect(provenGroupBrand(job, groupPortalBrands('vf-corporation', 'VF Corporation')), title).toBeUndefined();
      expect(provenGroupBrand({ ...job, title: title.replace('Vansittart', 'Nikesha') }, groupPortalBrands('nike-nke2', 'Nike')), title).toBeUndefined();
    }
    expect(brandOf(lift(real.westJordan))).toBe('Nike');
  });
  it('casse et accents : « KÉRASTASE » et « kerastase » nomment Kérastase', () => {
    const list = groupPortalBrands('l-oreal-professionnel', "L'Oréal (toutes Maisons)");
    for (const title of ['KERASTASE Educator', 'Éducateur kérastase', 'Educator Kérastase']) expect(provenGroupBrand({ title } as NormalizedJob, list)?.name).toBe('Kérastase');
  });
});

describe('ce qui reste retenu', () => {
  it('portail non relu (périmètre NULL) : la retenue demeure, même quand une marque est nommée', () => {
    for (const key of ['beyondYoga', 'levisStoreCode']) expect(lift(real[key], null)).toBe(real[key]);
  });
  it('liste du registre périmée : si `Source.maison` change, plus aucune marque n’est prouvée (le groupe seul)', () => {
    expect(groupPortalBrands('levis', 'Dockers')).toBeUndefined();
    const job = employerFromCertifiedScope(real.beyondYoga, 'Dockers', 'MULTI_BRAND', groupPortalBrands('levis', 'Dockers'));
    expect(brandOf(job)).toBeUndefined();
  });
  it('D-511 : une candidature spontanée retenue faute d’employeur n’est jamais levée, même sur un portail SINGLE_BRAND', () => {
    // L'intitulé réel (« Inviaci il tuo curriculum - Send us your CV ») échappe au lecteur D-511 : l'écart est remonté à
    // part. Le témoin porte la même offre sous un intitulé que ce lecteur reconnaît, et le prouve d'abord.
    const title = 'Candidatura spontanea - Send us your CV';
    const cv = { ...real.brunelloCv, title, raw: { ...(real.brunelloCv.raw as object), title } } as NormalizedJob & { source: string };
    expect(spontaneousApplicationProof(cv)).not.toBeNull();
    expect(employerFromCertifiedScope(cv, 'Brunello Cucinelli', 'SINGLE_BRAND')).toBe(cv);
    const onGroup = { ...cv, source: 'movado' };
    expect(lift(onGroup)).toBe(onGroup);
  });
});

describe('VF : l’entité juridique « VF Outdoor, LLC » cède devant la marque prouvée', () => {
  it('prémisse : l’offre réelle est publiable et nomme l’entité juridique, pas la marque', () => {
    expect(real.vfOutdoorTnf.publicationHold).toBeUndefined();
    expect(real.vfOutdoorTnf.employerEvidence).toMatchObject({ rawName: 'VF Outdoor, LLC', path: 'detail.hiringOrganization.name' });
    expect(real.vfOutdoorNoBrand.employerEvidence).toMatchObject({ rawName: 'VF Outdoor, LLC', path: 'detail.hiringOrganization.name' });
  });
  it('magasin The North Face nommé dans l’intitulé : la marque', () => {
    expect(brandOf(lift(real.vfOutdoorTnf))).toBe('The North Face');
  });
  it('aucune marque nommée : le libellé natif reste (il mène au groupe par l’alias relu)', () => {
    expect(lift(real.vfOutdoorNoBrand)).toBe(real.vfOutdoorNoBrand);
  });
  it('un libellé natif qui n’est pas une entité du groupe n’est jamais remplacé', () => {
    const native = { ...real.vfOutdoorTnf, company: 'Icebreaker New Zealand Limited', employerEvidence: { ...real.vfOutdoorTnf.employerEvidence!, rawName: 'Icebreaker New Zealand Limited' } };
    expect(lift(native)).toBe(native);
  });
  it('sur un portail non relu, rien ne change', () => {
    expect(lift(real.vfOutdoorTnf, null)).toBe(real.vfOutdoorTnf);
  });
});

describe('L’Oréal (Avature, dataLayer sans marque) : la même règle, hors Workday', () => {
  it('prémisse : l’offre ne porte ni employeur ni retenue', () => {
    for (const key of ['lorealKiehls', 'lorealYsl', 'lorealGroup']) {
      expect(real[key].publicationHold ?? real[key].company ?? real[key].employerEvidence, key).toBeUndefined();
    }
  });
  it('marque détenue nommée : Kiehl’s ; marque sous licence (YSL) ou nom du groupe : rien, le résolveur publie sous le groupe', () => {
    expect(brandOf(lift(real.lorealKiehls))).toBe("Kiehl's");
    expect(lift(real.lorealYsl)).toBe(real.lorealYsl);
    expect(lift(real.lorealGroup)).toBe(real.lorealGroup);
  });
});

describe('provenance à part, jamais un libellé natif', () => {
  it('les deux origines nouvelles sont des origines de portail, jamais natives (R-143 « même Maison »)', () => {
    for (const origin of [`${GROUP_BRAND_PATH}:${GROUP_BRAND_RULE}`, `${CERTIFIED_SCOPE_PATH}:${GROUP_SCOPE_RULE}`]) {
      expect(isPortalEmployerOrigin(origin), origin).toBe(true);
      expect(isNativeOrigin(origin), origin).toBe(false);
    }
    expect(isGroupBrandOrigin(`${GROUP_BRAND_PATH}:${GROUP_BRAND_RULE}`)).toBe(true);
    expect(isPortalEmployerOrigin('detail.hiringOrganization.name:HIRING_ORGANIZATION_LABEL')).toBe(false);
  });
});

/**
 * Suite d'audit D-522 §6 (03/10/2026) : groupe nommé, lieux homonymes, licences, groupe Prada. Offres réelles réduites
 * (`__fixtures__/group-brands-20261002.json`) : cassette Prada du 03/10, offres actives L'Oréal du 03/10, sans-employeur du 02/10.
 */
describe('une marque homonyme d’un lieu n’est lue ni dans le lieu, ni après un mot de lieu', () => {
  it('« Usine de Vichy » est un lieu ; « Marketing Intern VICHY » nomme la marque', () => {
    expect(real.lorealVichyPlace.title).toMatch(/Usine de Vichy/);
    expect(lift(real.lorealVichyPlace)).toBe(real.lorealVichyPlace);
    expect(brandOf(lift(real.lorealVichyBrand))).toBe('Vichy');
  });
  it('un lieu « Vichy, France » ou « Kipling Ave, Toronto » ne nomme aucune marque', () => {
    const vichy = { ...real.lorealVichyBrand, title: 'Supply Chain Engineer', location: 'Vichy, Auvergne-Rhône-Alpes, France', raw: { title: 'Supply Chain Engineer', location: 'Vichy' } };
    expect(lift(vichy)).toBe(vichy);
    const kipling = { ...real.vfNoBrand, location: 'Kipling Ave, Toronto', raw: { ...(real.vfNoBrand.raw as object), locationsText: 'USCA > CAN > Ontario > 30 Kipling Ave' } } as NormalizedJob & { source: string };
    expect(brandOf(lift(kipling))).toBeUndefined();
  });
});

describe('marque sous licence : jamais la Maison homonyme', () => {
  it('prémisse : l’offre L’Oréal porte le libellé natif « Prada » (dataLayer), aujourd’hui publiée sous PRADA', () => {
    expect(real.lorealPradaLicence.employerEvidence).toMatchObject({ rawName: 'Prada', path: 'dataLayer.jobBrand' });
  });
  it('sur le portail L’Oréal relu, « Prada » et « Maison Margiela » (licences) publient sous L’Oréal Groupe, provenance à part', () => {
    for (const [key, label] of [['lorealPradaLicence', 'Prada'], ['lorealMargielaLicence', 'Maison Margiela']] as const) {
      expect(lift(real[key]).employerEvidence, key).toEqual({ rawName: "L'Oréal Groupe", path: CERTIFIED_SCOPE_PATH, rule: GROUP_LICENCE_RULE, role: 'GROUP', brands: [label] });
    }
    expect(isPortalEmployerOrigin(`${CERTIFIED_SCOPE_PATH}:${GROUP_LICENCE_RULE}`)).toBe(true);
  });
  it('une offre L’Oréal qui nomme Prada dans son intitulé, sans libellé, n’est jamais attribuée à PRADA', () => {
    const job = { ...real.lorealVichyBrand, title: 'Prada Beauté Advisor - Galeries Lafayette', raw: { title: 'Prada Beauté Advisor - Galeries Lafayette' } };
    expect(lift(job)).toBe(job);
  });
  it('réciproque : sur le portail Prada, une offre qui nomme L’Oréal ne part jamais sous une Maison L’Oréal', () => {
    const job = { ...real.pradaGroupNoBrand, title: "L'Oréal Luxe Partnership Manager", raw: { ...(real.pradaGroupNoBrand.raw as object), title: "L'Oréal Luxe Partnership Manager" } } as NormalizedJob & { source: string };
    expect(lift(job)).toBe(job);
  });
  it('un libellé natif de marque détenue (« Aesop ») reste natif : il mène déjà à sa Maison', () => {
    expect(lift(real.lorealAesopNative)).toBe(real.lorealAesopNative);
  });
});

describe('groupe Prada (colonne « Brand » de la liste, `brandProperty: facility`)', () => {
  it('Marchesi 1824 (hors périmètre, décision CEO en attente) : retenue avec retrait daté, jamais attribuée', () => {
    const at = new Date('2026-10-03T16:00:00Z');
    for (const key of ['pradaMarchesiTitle', 'pradaMarchesiColumn']) {
      const job = employerFromCertifiedScope(real[key], 'Prada Group', 'MULTI_BRAND', groupPortalBrands('prada-group', 'Prada Group'), at);
      expect(job.publicationHold, key).toBe(GROUP_OUT_OF_PERIMETER_HOLD);
      expect(job.publicationWithdrawnAt, key).toEqual(at);
      expect(job.employerEvidence?.rawName, key).toBe('Marchesi 1824');
    }
    expect(publicationDisposition(GROUP_OUT_OF_PERIMETER_HOLD)).toEqual({ kind: 'WITHDRAWN', reason: 'OUT_OF_SCOPE' });
    expect(retentionClass(GROUP_OUT_OF_PERIMETER_HOLD)).toBe('TEAM_DECISION');
  });
  it('marque prouvée : « ミュウミュウ » est Miu Miu ; « Prada Group » avec « PRADA » dans l’intitulé est Prada', () => {
    expect(brandOf(lift(real.pradaMiuMiuJa))).toBe('Miu Miu');
    expect(brandOf(lift(real.pradaGroupTitlePrada))).toBe('Prada');
  });
  it('sans marque : « Prada Group » reste (son libellé natif mène au groupe) ; « Prada » natif reste natif', () => {
    expect(lift(real.pradaGroupNoBrand)).toBe(real.pradaGroupNoBrand);
    expect(lift(real.pradaColumnPrada)).toBe(real.pradaColumnPrada);
  });
  it('portail non relu : rien ne change, Marchesi comprise', () => {
    expect(lift(real.pradaMarchesiColumn, null)).toBe(real.pradaMarchesiColumn);
  });
});
