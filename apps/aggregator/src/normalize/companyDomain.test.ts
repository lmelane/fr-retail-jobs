import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  domainFromEmployerSources,
  hostFromOfficialWebsite,
  nameMatchesDomain,
  pickWikidataEntity,
  resolveCompanyDomain,
  resolveViaWikidata,
  rootDomainOf,
  wikidataSearchTerms,
  type WikidataClaimsResponse,
  type WikidataClient,
  type WikidataSearchResponse,
} from './companyDomain.js';

/**
 * Le logo d'une Maison est le favicon de son domaine. Deviné depuis le nom, le
 * domaine tombe souvent sur une AUTRE entreprise (`mac.com`, `omega.com`) et le
 * logo ment. Ici le domaine vient d'une source qui NOMME la Maison — le
 * catalogue (domaine carrière) ou Wikidata (P856) — ou de rien : l'initiale
 * vaut mieux qu'un logo faux.
 */

function fixture<T>(name: string): T {
  const path = fileURLToPath(new URL(`./__fixtures__/wikidata/${name}.json`, import.meta.url));
  return JSON.parse(readFileSync(path, 'utf8')) as T;
}

describe('rootDomainOf — la racine d’un domaine carrière', () => {
  it.each([
    ['careers.hermes.com', 'hermes.com'],
    ['jobs.sephora.com', 'sephora.com'],
    ['carrieres.groupegalerieslafayette.com', 'groupegalerieslafayette.com'],
    ['recrutement.beautysuccess.fr', 'beautysuccess.fr'],
    ['talents.ba-sh.com', 'ba-sh.com'],
    ['emploi.prismamedia.com', 'prismamedia.com'],
    ['work-with-us.buff.com', 'buff.com'],
    ['careers-group.loccitane.com', 'loccitane.com'],
    ['jobs-fr.loccitane.com', 'loccitane.com'],
    ['company.marc-o-polo.com', 'marc-o-polo.com'],
    ['www.careers.fenwick.co.uk', 'fenwick.co.uk'],
    ['careers.ackermans.co.za', 'ackermans.co.za'],
    ['empleos.palaciohierro.com.mx', 'palaciohierro.com.mx'],
    ['careers.bevilles.com.au', 'bevilles.com.au'],
    ['jobs.douglas.group', 'douglas.group'],
    ['www.lvmh.com', 'lvmh.com'],
    ['hub-urbn.example.com', 'example.com'],
    // Suffixes publics hors de toute liste maison (Public Suffix List) :
    // « co.id » n'était pas dans les 18 suffixes codés, URBN affichait un
    // logo pour « co.id » (prod, 2026-09-06).
    ['www.urbanjakarta.co.id', 'urbanjakarta.co.id'],
    ['tnw.waw.pl', 'tnw.waw.pl'],
    ['careers.harveynichols.co.uk', 'harveynichols.co.uk'],
    ['jobs.fastretailing.co.jp', 'fastretailing.co.jp'],
  ])('%s -> %s', (host, root) => {
    expect(rootDomainOf(host)).toBe(root);
  });

  it('retire un mot carrière collé ou accolé au label lui-même', () => {
    expect(rootDomainOf('www.carrieres-rolex.com')).toBe('rolex.com');
    expect(rootDomainOf('recrutement-nocibe.fr')).toBe('nocibe.fr');
    expect(rootDomainOf('burberrycareers.com')).toBe('burberry.com');
  });

  it('accepte un hôte avec schéma, port ou chemin', () => {
    expect(rootDomainOf('https://careers.crocs.com/fr/')).toBe('crocs.com');
    expect(rootDomainOf('careers.crocs.com:443')).toBe('crocs.com');
  });

  it('rend null pour un hôte ATS : ce n’est pas le domaine de la Maison', () => {
    for (const host of [
      'richemont.wd3.myworkdayjobs.com',
      'careers-aeropostale.icims.com',
      'axelarigato.teamtailor.com',
      'eljs.fa.us2.oraclecloud.com',
      'lde.tbe.taleo.net',
      'performancemanager5.successfactors.eu',
      'loreal.avature.net',
      'jobs.lever.co',
      'boards.greenhouse.io',
      'job-boards.greenhouse.io',
      'jobs.smartrecruiters.com',
      'careers.smartrecruiters.com',
      'closed.jobs.personio.de',
      'bego.recruitee.com',
      'balmain-career.talent-soft.com',
      'laredoute-talent.talentview.io',
      'apply.workable.com',
      'emp.jobylon.com',
      'www.welcometothejungle.com',
      'fr.fashionjobs.com',
    ]) {
      expect(rootDomainOf(host), host).toBeNull();
    }
  });

  it('rend null pour ce qui n’est pas un hôte', () => {
    expect(rootDomainOf('')).toBeNull();
    expect(rootDomainOf('   ')).toBeNull();
    expect(rootDomainOf('localhost')).toBeNull();
    expect(rootDomainOf('127.0.0.1')).toBeNull();
    expect(rootDomainOf('not a host')).toBeNull();
  });
});

describe('nameMatchesDomain — un domaine de groupe n’est pas crédité à une marque', () => {
  it.each([
    ['Hermès', 'hermes.com'],
    ['Foot Locker France', 'footlocker.com'],
    ['Galeries Lafayette', 'groupegalerieslafayette.com'],
    ['Clarins', 'groupeclarins.com'],
    ['Etam', 'groupeetam.com'],
    ['ba&sh', 'ba-sh.com'],
    ['Dolce & Gabbana', 'dolcegabbana.com'],
    ['Dr. Martens', 'drmartens.com'],
    ['Ulta Beauty', 'ulta.com'],
    ['Hoff', 'thehoffbrand.com'],
    ['L’Occitane en Provence', 'loccitane.com'],
    ['G.Label by Goop', 'goop.com'],
    ['Pandora', 'pandoragroup.com'],
    ['Fenwick', 'fenwick.co.uk'],
  ])('%s ~ %s', (name, domain) => {
    expect(nameMatchesDomain(name, domain)).toBe(true);
  });

  it.each([
    ['Element', 'groupe-beaumanoir.com'],
    ['Escada Parfums', 'coty.com'],
    ['Jean Paul Gaultier', 'puig.com'],
    ['Drunk Elephant', 'shiseido.com'],
    ['Maison Margiela', 'otb.net'],
    ['Dr Pierre Ricaud', 'groupe-rocher.com'],
    ['NARS', 'shiseidoamericas.com'],
    ['Army Logic', 'hypebeast.cn'],
    ['f.a.e.', 'thrivemarket.com'],
  ])('%s !~ %s', (name, domain) => {
    expect(nameMatchesDomain(name, domain)).toBe(false);
  });
});

describe('domainFromEmployerSources — chemin (i), sans réseau', () => {
  const sources = [
    { maison: 'Hermès', tier: 'SPECIALIST_JOBBOARD', careersDomain: '' },
    { maison: 'Sephora', tier: 'EMPLOYER_DIRECT', careersDomain: 'jobs.sephora.com' },
    { maison: 'Tiffany & Co.', tier: 'EMPLOYER_DIRECT', careersDomain: 'eljs.fa.us2.oraclecloud.com' },
    { maison: 'Element +6', tier: 'EMPLOYER_DIRECT', careersDomain: 'recrutement.groupe-beaumanoir.com' },
    { maison: 'Kering (toutes Maisons)', tier: 'EMPLOYER_DIRECT', careersDomain: 'careers.kering.com' },
    { maison: 'Clarins', tier: 'SPECIALIST_JOBBOARD', careersDomain: 'welcometothejungle.com' },
    { maison: 'Clarins', tier: 'EMPLOYER_DIRECT', careersDomain: 'careers.groupeclarins.com' },
    { maison: 'Nike', tier: 'ATS_OFFICIAL', careersDomain: 'jobs.nike.com' },
    { maison: 'Army Logic', tier: 'ATS_OFFICIAL', careersDomain: 'hypebeast.cn' },
  ];

  it('rend la racine du domaine carrière de la source qui nomme la Maison', () => {
    expect(domainFromEmployerSources('SEPHORA', sources)).toBe('sephora.com');
    expect(domainFromEmployerSources('CLARINS', sources)).toBe('groupeclarins.com');
    expect(domainFromEmployerSources('NIKE', sources)).toBe('nike.com');
  });

  it('résout la Maison via resolveCompany : le « (toutes Maisons) » et le « +N » ne comptent pas', () => {
    expect(domainFromEmployerSources('KERING', sources)).toBe('kering.com');
  });

  it('rend null quand la seule source est un hôte ATS, un jobboard ou un domaine de groupe', () => {
    expect(domainFromEmployerSources('TIFFANY', sources)).toBeNull();
    expect(domainFromEmployerSources('HERMES', sources)).toBeNull();
    expect(domainFromEmployerSources('ELEMENT', sources)).toBeNull();
    expect(domainFromEmployerSources('ARMY_LOGIC', sources)).toBeNull();
    expect(domainFromEmployerSources('DIOR', sources)).toBeNull();
  });
});

describe('wikidataSearchTerms — le nom tel qu’une encyclopédie le connaît', () => {
  it('retire la forme juridique, même empilée', () => {
    expect(wikidataSearchTerms('Ulta Beauty, Inc.')).toEqual(['Ulta Beauty']);
    expect(wikidataSearchTerms('MANGO MNG, S.A.')).toEqual(['MANGO MNG']);
    expect(wikidataSearchTerms('Nordstrom Inc')).toEqual(['Nordstrom']);
    expect(wikidataSearchTerms('MECCA Brands Pty Ltd')).toEqual(['MECCA Brands']);
    expect(wikidataSearchTerms('Laverana GmbH & Co. KG')).toEqual(['Laverana']);
  });

  it('laisse un nom déjà simple tel quel, sans doublon', () => {
    expect(wikidataSearchTerms('Cartier')).toEqual(['Cartier']);
    expect(wikidataSearchTerms('Tiffany & Co.')).toEqual(['Tiffany & Co.']);
  });
});

describe('pickWikidataEntity — l’entité qui est la Maison, pas son homonyme', () => {
  it('Dior : la maison de mode, pas le nom de famille ni la chanson', () => {
    const picked = pickWikidataEntity(fixture<WikidataSearchResponse>('search-dior-fr').search, 'Dior');
    expect(picked?.id).toBe('Q542767');
  });

  it('Cartier : la marque, pas la police de caractères ni la station de métro', () => {
    const picked = pickWikidataEntity(fixture<WikidataSearchResponse>('search-cartier-fr').search, 'Cartier');
    expect(picked?.id).toBe('Q538587');
  });

  it('Omega : la marque d’horlogerie, pas le « groupe de rock hongrois » listé avant elle', () => {
    const picked = pickWikidataEntity(fixture<WikidataSearchResponse>('search-omega-fr').search, 'Omega');
    expect(picked?.id).toBe('Q659224');
  });

  it('Tom Ford : la maison de luxe en 7e position, jamais le styliste ni le joueur de snooker', () => {
    const picked = pickWikidataEntity(fixture<WikidataSearchResponse>('search-tom-ford-fr').search, 'Tom Ford');
    expect(picked?.id).toBe('Q105476592');
  });

  it('Ulta Beauty : « enterprise » seul suffit — c’est une entreprise, pas un homonyme', () => {
    const picked = pickWikidataEntity(fixture<WikidataSearchResponse>('search-ulta-beauty-fr').search, 'Ulta Beauty');
    expect(picked?.id).toBe('Q7880076');
  });

  it('Louis Vuitton : la maison au libellé exact, pas LVMH — mieux noté mais un autre nom', () => {
    // LVMH (« groupe … d'entreprises de luxe ») score plus haut que « maison … de
    // maroquinerie de luxe » ; sans la préférence au libellé exact, le logo de
    // Louis Vuitton était celui du groupe (mesuré en prod, g7-check).
    const picked = pickWikidataEntity(fixture<WikidataSearchResponse>('search-louis-vuitton-fr').search, 'Louis Vuitton');
    expect(picked?.id).toBe('Q191485');
  });

  it('MAC : ni le macédonien, ni Macao, ni macOS — rien, donc l’initiale', () => {
    expect(pickWikidataEntity(fixture<WikidataSearchResponse>('search-mac-fr').search, 'MAC')).toBeNull();
    expect(pickWikidataEntity(fixture<WikidataSearchResponse>('search-mac-en').search, 'MAC')).toBeNull();
  });
});

describe('hostFromOfficialWebsite — P856 vers un hôte nu', () => {
  it('lit l’URL, retire www. et préfère le rang « preferred »', () => {
    expect(hostFromOfficialWebsite(fixture<WikidataClaimsResponse>('claims-cartier'))).toBe('cartier.com');
    expect(hostFromOfficialWebsite(fixture<WikidataClaimsResponse>('claims-dior'))).toBe('dior.com');
    expect(hostFromOfficialWebsite(fixture<WikidataClaimsResponse>('claims-omega'))).toBe('omegawatches.com');
    expect(hostFromOfficialWebsite(fixture<WikidataClaimsResponse>('claims-ulta-beauty'))).toBe('ulta.com');
  });

  it('ramène un site régional à la racine : 43 sites Louis Vuitton, un seul domaine', () => {
    expect(hostFromOfficialWebsite(fixture<WikidataClaimsResponse>('claims-louis-vuitton'))).toBe('louisvuitton.com');
    expect(
      hostFromOfficialWebsite({ claims: { P856: [{ rank: 'normal', mainsnak: { datavalue: { value: 'https://fr.louisvuitton.com/fra-fr/homepage' } } }] } }),
    ).toBe('louisvuitton.com');
  });

  it('préfère un site « preferred » à un « normal » listé avant lui, et ignore « deprecated »', () => {
    const claims: WikidataClaimsResponse = {
      claims: {
        P856: [
          { rank: 'deprecated', mainsnak: { datavalue: { value: 'https://old.example.org' } } },
          { rank: 'normal', mainsnak: { datavalue: { value: 'https://www.example.fr/' } } },
          { rank: 'preferred', mainsnak: { datavalue: { value: 'https://www.example.com/' } } },
        ],
      },
    };
    expect(hostFromOfficialWebsite(claims)).toBe('example.com');
  });

  it('rend null sans P856 ou avec une valeur qui n’est pas une URL', () => {
    expect(hostFromOfficialWebsite({ claims: {} })).toBeNull();
    expect(
      hostFromOfficialWebsite({ claims: { P856: [{ rank: 'normal', mainsnak: { datavalue: { value: 'n/a' } } }] } }),
    ).toBeNull();
  });
});

/** Un client Wikidata rejoué depuis les fixtures capturées : aucun réseau. */
function fixtureClient(log: string[] = []): WikidataClient {
  const searches: Record<string, string> = {
    'Dior|fr': 'search-dior-fr',
    // Le double répond la même page pour le nom stocké en base : le test
    // d'orchestration vérifie le repli sur Wikidata, pas le classement réel.
    'Christian Dior Couture|fr': 'search-dior-fr',
    'Cartier|fr': 'search-cartier-fr',
    'Omega|fr': 'search-omega-fr',
    'Tom Ford|fr': 'search-tom-ford-fr',
    'MAC|fr': 'search-mac-fr',
    'MAC|en': 'search-mac-en',
    'Ulta Beauty|fr': 'search-ulta-beauty-fr',
  };
  const claims: Record<string, string> = {
    Q542767: 'claims-dior',
    Q538587: 'claims-cartier',
    Q659224: 'claims-omega',
    Q105476592: 'claims-tom-ford',
    Q7880076: 'claims-ulta-beauty',
  };
  return {
    async search(term, language) {
      log.push(`search ${term} ${language}`);
      const name = searches[`${term}|${language}`];
      return name ? fixture<WikidataSearchResponse>(name) : { search: [] };
    },
    async officialWebsite(id) {
      log.push(`claims ${id}`);
      const name = claims[id];
      return name ? fixture<WikidataClaimsResponse>(name) : { claims: {} };
    },
  };
}

describe('resolveViaWikidata — chemin (ii)', () => {
  it('nom -> entité filtrée -> P856 -> hôte', async () => {
    expect(await resolveViaWikidata('Cartier', fixtureClient())).toBe('cartier.com');
    expect(await resolveViaWikidata('Tom Ford', fixtureClient())).toBe('tomford.com');
    expect(await resolveViaWikidata('Ulta Beauty, Inc.', fixtureClient())).toBe('ulta.com');
  });

  it('cherche en français puis en anglais, et s’arrête à rien plutôt que d’inventer', async () => {
    const log: string[] = [];
    expect(await resolveViaWikidata('MAC', fixtureClient(log))).toBeNull();
    expect(log).toEqual(['search MAC fr', 'search MAC en']);
  });

  it('passe à l’entité suivante quand la retenue n’a pas de site officiel', async () => {
    const log: string[] = [];
    const client: WikidataClient = {
      async search() {
        return {
          search: [
            { id: 'Q1', label: 'Exemple', description: 'entreprise de mode' },
            { id: 'Q2', label: 'Exemple', description: 'marque de luxe' },
          ],
        };
      },
      async officialWebsite(id) {
        log.push(id);
        return id === 'Q2' ? { claims: { P856: [{ rank: 'normal', mainsnak: { datavalue: { value: 'https://www.exemple.com' } } }] } } : { claims: {} };
      },
    };
    expect(await resolveViaWikidata('Exemple', client)).toBe('exemple.com');
    expect(log).toEqual(['Q1', 'Q2']);
  });

  it('refuse un site officiel qui ne porte pas le nom : l’homonyme d’une autre entreprise', async () => {
    // Prod 2026-09-06 : « URBN » → « Urban Jakarta Propertindo » (Indonesian
    // company) → urbanjakarta.co.id ; « Wing » → x.company ; « Dunhill » → bat.com.
    const client: WikidataClient = {
      async search() {
        return {
          search: [
            { id: 'Q1', label: 'Urban Jakarta Propertindo', description: 'Indonesian company' },
            { id: 'Q2', label: 'URBN', description: 'American retail company' },
          ],
        };
      },
      async officialWebsite(id) {
        const site = id === 'Q1' ? 'https://www.urbanjakarta.co.id' : 'https://www.urbn.com';
        return { claims: { P856: [{ rank: 'normal', mainsnak: { datavalue: { value: site } } }] } };
      },
    };
    // Le libellé exact « URBN » prime (Q2) ; si seule Q1 existait, rien.
    expect(await resolveViaWikidata('URBN', client)).toBe('urbn.com');
    const onlyHomonym: WikidataClient = {
      async search() {
        return { search: [{ id: 'Q1', label: 'Urban Jakarta Propertindo', description: 'Indonesian company' }] };
      },
      officialWebsite: client.officialWebsite,
    };
    expect(await resolveViaWikidata('URBN', onlyHomonym)).toBeNull();
  });

  it('ne lit les claims qu’une fois, pour l’entité retenue', async () => {
    const log: string[] = [];
    await resolveViaWikidata('Omega', fixtureClient(log));
    expect(log).toEqual(['search Omega fr', 'claims Q659224']);
  });
});

describe('resolveCompanyDomain — (i) catalogue, sinon (ii) Wikidata, sinon rien', () => {
  const sources = [{ maison: 'Sephora', tier: 'EMPLOYER_DIRECT', careersDomain: 'jobs.sephora.com' }];

  it('préfère le catalogue et ne touche pas au réseau quand il suffit', async () => {
    const log: string[] = [];
    const result = await resolveCompanyDomain({ name: 'Sephora', canonicalKey: 'SEPHORA' }, sources, fixtureClient(log));
    expect(result).toEqual({ domain: 'sephora.com', domainSource: 'source-careers' });
    expect(log).toEqual([]);
  });

  it('tombe sur Wikidata pour une marque de flux de groupe', async () => {
    const result = await resolveCompanyDomain(
      { name: 'Christian Dior Couture', canonicalKey: 'DIOR' },
      sources,
      fixtureClient(),
    );
    expect(result).toEqual({ domain: 'dior.com', domainSource: 'wikidata' });
  });

  it('rend null quand rien ne nomme la Maison', async () => {
    expect(await resolveCompanyDomain({ name: 'MAC', canonicalKey: 'MAC' }, sources, fixtureClient())).toBeNull();
  });
});
