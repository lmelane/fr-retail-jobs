import { describe, expect, it } from 'vitest';
import type { NormalizedJob } from '../types.js';
import { applySpontaneousApplicationRule, SPONTANEOUS_APPLICATION_HOLD, spontaneousApplicationProof } from './spontaneousApplication.js';

/**
 * D-511 — les témoins portent les intitulés RÉELS des offres publiques du 02/10/2026 (lecture seule de la production,
 * `audits/2026-10-02/d511-candidatures-spontanees/`), et les vrais postes qui contiennent le mot.
 */
const job = (title: string, extra: Partial<NormalizedJob> = {}): NormalizedJob =>
  ({ externalId: 'x', title, url: 'https://example.com/jobs/x', raw: { title }, ...extra });
const observedAt = new Date('2026-10-02T16:00:00Z');

describe('D-511 : une candidature spontanée reconnue sur sa preuve native', () => {
  it.each([
    'Candidature spontanée', 'Candidatures spontanées', 'CANDIDATURE SPONTANÉE - Responsable de Boutique H/F - Paris',
    'Candidature Spontanée Chef(fe) de Produit Développement et Opérationnel Sénior - H/F',
    'Conseiller.ère de vente - Candidature spontanée', '[Candidature spontanée] Designer', '[Spontaneous application] Designer',
    'Spontaneous Application', 'Spontaneous applications - Portugal', 'Spontaneous Application Beauty Advisor La Prairie / Chantecaille',
    'Unsolicited Applications', 'WE ARE LOOKING FOR YOU! - Unsolicited application Headquarters m/f/d',
    'Initiativbewerbung', 'Initiativbewerbung (m/w/d)', 'Initiativbewerbung Kaufmännisch (m/w/d)', 'MICHAEL KORS - Initiativbewerbung',
    'CREATE AN IMPACT // Initiativbewerbung Festanstellung', 'Junior Manager Sales NIVEA (w/m/d) Initiativbewerbung',
    'Initiativbewerbung | Sales Associate (m/w/d) in einer unserer Boutiquen am Standort München', 'Spontanbewerbung',
    'Open Sollicitatie', 'Open sollicitatie', '1_Candidatura Spontanea', 'Open Application and Internships - Gothenburg',
    'Open Application - Internship', 'Fashion Designer - H&M Womens, Kids, Mens, Lifestyle - Open Application',
    'Fashion Design - Open Application H&M Group', 'General Application', 'General Applications - Product Development',
    "General Application: You're Good at Everything",
    // langues servies, sans occurrence le 02/10
    'Candidatura espontánea', 'Candidatura spontanea - Milano', 'Candidature ouverte', 'Öppen ansökan', 'Åpen søknad',
    'Uopfordret ansøgning', 'Avoin hakemus', 'Autocandidatura', 'Candidatura libera', 'Candidatura abierta', 'Spontane Bewerbung',
    'Candidatures spontanées et alternance',
    // l'intitulé tel que l'adaptateur le rend, avant le nettoyage de l'écriture (entités, comme chez Beiersdorf)
    'Candidature spontan&#233;e', 'Candidature <b>spontanée</b>',
  ])('retenue : « %s »', (title) => {
    expect(spontaneousApplicationProof(job(title))).toMatchObject({ kind: 'TITLE_LABEL' });
  });

  it.each([
    // le garde-fou du CEO : un vrai poste qui contient le mot n'est jamais retiré
    'Chargé des candidatures spontanées', 'Chargé(e) des candidatures spontanées H/F', 'Gestionnaire candidatures spontanées et alternance',
    'Sachbearbeiter Initiativbewerbungen (m/w/d)', 'Recruiter for spontaneous applications', 'Coordinator of Open Applications',
    // « open » dans un autre sens, et « application » au sens du logiciel
    'Store Opening Manager', 'Open-to-close Sales Associate', 'Grand Opening Team Member', 'Open Application Platform Engineer',
    'Recruiter - Open Applications Team', 'General Application Support Analyst', 'Application Developer', 'General Manager',
    'Recruteur (candidatures spontanées)', 'Talent Acquisition Specialist, Spontaneous Applications',
    // l'audit adverse du 02/10 : un pluriel après un séparateur nomme le domaine d'un poste ; une fonction ou une
    // invitation après le libellé en fait une vraie offre ; « candidatures ouvertes » n'est pas un libellé
    'Chargé(e) de recrutement - Candidatures spontanées et alternance', 'Talent Acquisition Specialist - Spontaneous Applications',
    'Recruiter (m/w/d) Initiativbewerbungen', 'Sachbearbeiter (m/w/d) Initiativbewerbungen & Ausbildung',
    'HR Assistant | Open Applications & Onboarding', 'Verkäufer (m/w/d) - Initiativbewerbung möglich',
    'Kassierer (m/w/d) | Initiativbewerbungen willkommen', 'Client Advisor - Open applications welcome',
    'Store Manager - Open Application Day Paris', 'Recruteur - Candidatures spontanées', 'Chargé de recrutement / Candidatures spontanées',
    'Assistant RH | Candidatures spontanées et alternance', 'Spontaneous Applications Coordinator',
    'Talent Acquisition: Unsolicited Applications Manager', 'Stage Marketing - Candidatures ouvertes',
    'Candidatures ouvertes : Vendeur Saisonnier H/F', 'IT Manager - General Applications', 'General Applications/Systems Engineer',
    'Open Application Data Engineer', 'Junior Sales - Open Application Process', 'Initiativbewerbung möglich: Verkäufer',
    // « initiativ » et « spontan » préfixes d'autres mots
    'Manager, Retail Operations, Initiatives - APAC', 'Senior Manager - Strategic Initiatives & Transformation, North Asia',
    'Initiative Management Team Leader', 'Spontaneous and creative Visual Merchandiser',
    // hors règle (lecture D-492 sous D-511) : un poste et un lieu nommés
    'Talent Pool - Sales Associate Morocco Talborjt - Agadir', 'Client Advisor | Future Opportunities | London',
    'MECCA Claremont - Host Expression of Interest', 'Vivier - Délégué Pharmaceutique - Région Centre', 'Boots UK Pharmacist - Register your interest',
  ])('publiée : « %s »', (title) => {
    expect(spontaneousApplicationProof(job(title))).toBeNull();
  });

  it('le champ natif de l\'éditeur suffit, quel que soit l\'intitulé (TalentRecruiter « OpenApplication », SmartRecruiters)', () => {
    expect(spontaneousApplicationProof(job('Εκδήλωση Ενδιαφέροντος', { opportunityType: 'OPEN_APPLICATION' })))
      .toEqual({ kind: 'NATIVE_FIELD', path: 'opportunityType', value: 'OPEN_APPLICATION' });
    expect(spontaneousApplicationProof(job('Client Advisor', { opportunityType: 'JOB_OPENING' }))).toBeNull();
  });
});

describe('D-511 : la lecture reste bornée', () => {
  it('un intitulé démesuré est lu en temps borné (pas de découpage quadratique)', () => {
    const started = Date.now();
    expect(spontaneousApplicationProof(job('Sales Advisor ' + '- '.repeat(100_000)))).toBeNull();
    expect(Date.now() - started).toBeLessThan(500);
  });
});

describe('D-511 : la retenue et son retrait daté', () => {
  it('retient et date le retrait ; un vrai poste reste le même objet, sans retenue', () => {
    expect(applySpontaneousApplicationRule(job('Candidature spontanée'), observedAt))
      .toMatchObject({ publicationHold: SPONTANEOUS_APPLICATION_HOLD, publicationWithdrawnAt: observedAt });
    const real = job('Chargé des candidatures spontanées');
    expect(applySpontaneousApplicationRule(real, observedAt)).toBe(real);
  });

  it('une autre preuve de retrait garde sa raison ; une retenue sans retrait cède à la candidature spontanée', () => {
    const gone = job('Candidature spontanée', { publicationHold: 'APPLICATION_HTTP_404' });
    expect(applySpontaneousApplicationRule(gone, observedAt)).toBe(gone);
    const dated = job('Candidature spontanée', { publicationHold: 'SOURCE_UNLISTED', publicationWithdrawnAt: new Date('2026-10-01T00:00:00Z') });
    expect(applySpontaneousApplicationRule(dated, observedAt)).toBe(dated);
    expect(applySpontaneousApplicationRule(job('Initiativbewerbung', { publicationHold: 'JSONLD_EMPLOYER_NOT_RESOLVED' }), observedAt))
      .toMatchObject({ publicationHold: SPONTANEOUS_APPLICATION_HOLD, publicationWithdrawnAt: observedAt });
  });
});

describe('D-511, D-512 : la lecture reste bornée avant le nettoyage', () => {
  it('un intitulé fait de balises ouvrantes est lu en temps borné (tronqué avant cleanTitle)', () => {
    const started = Date.now();
    expect(spontaneousApplicationProof(job('<'.repeat(100_000)))).toBeNull();
    expect(Date.now() - started).toBeLessThan(500);
  });
});

/**
 * D-512 — les viviers. Intitulés RÉELS des offres publiques du 02/10/2026 (`audits/2026-10-02/d512-viviers/`), avec le
 * lieu et la Maison que l'offre porte, et les exemples de la demande. Un vivier dont le reste ne nomme qu'un lieu, une
 * Maison, un pays, une langue ou des mots vides est retenu ; tout autre mot, connu ou non, le garde publié.
 */
const at = (title: string, company?: string, location?: string, country?: string) => ({ title, company, location, country });
describe('D-512 : un vivier sans poste est retenu, tout autre mot le garde publié', () => {
  it.each([
    at('Talent Pool'), at('Future Opportunities - Paris', 'Mejuri', 'Paris', 'FR'), at('Mejuri Talent Community', 'Mejuri'),
    at('Talent Pool Paris', 'Sandro', 'Paris, France', 'FR'),
    at('Future Opportunities - (Boston)', 'Mejuri', 'Boston', 'US'), at('Future Opportunities - (Bay Area)', 'Mejuri', 'San Francisco Bay Area', 'US'),
    at('Future Opportunities - (DMV)', 'Mejuri', 'DMV', 'US'), at('Future Opportunities - (Greater Seattle Area)', 'Mejuri', 'Greater Seattle Area', 'US'),
    at('Future Opportunities - (London, UK)', 'Mejuri', 'London, UK', 'GB'), at('Future Opportunities - (Washington Square)', 'Mejuri', 'Washington Square, Tigard'),
    at('BRIONI APAC Expression of interest', 'Brioni', 'Shanghai, Shanghai, Mainland China', 'CN'),
    at('HUGO BOSS IZMIR TALENT NETWORK', 'HUGO BOSS Textile Ind. Ltd.', 'Izmir, Izmir', 'TR'), at('Join the PVH Talent Community', 'PVH'),
    at("Apply here to join Nutrafol's Talent Community!", 'Nutrafol', 'Remote (United States)', 'US'),
    at('Talent Pool - Germany', 'Hugo Boss'), at('Talent Pool - German speaking', 'Hugo Boss'), at('Vivier de candidats'),
    at('VIVIER - Paris', 'Aigle', 'Paris'), at('Register your interest'), at('Expressions of Interest'), at('Opportunités futures - Lyon', 'Sézane', 'Lyon'),
    at('Talentpool'), at('Bolsa de Talentos - Santiago 2025', 'Tiffany', 'Santiago', 'CL'),
  ])('retenu : « $title »', (offre) => {
    expect(spontaneousApplicationProof(job(offre.title, offre))).toMatchObject({ kind: 'TALENT_POOL' });
    expect(applySpontaneousApplicationRule(job(offre.title, offre), observedAt))
      .toMatchObject({ publicationHold: SPONTANEOUS_APPLICATION_HOLD, publicationWithdrawnAt: observedAt });
  });

  it.each([
    // les exemples de la décision et de la demande
    'Future Opportunities - Store Manager', 'Talent Pool: Sales Associate', 'Talent Acquisition Partner', 'Talent Pool Coordinator',
    // un poste, une fonction, une famille ou une équipe, qu'ils se disent « Team » ou non
    'Client Advisor | Future Opportunities | London', 'Customer Experience Manager - London Future Opportunities',
    'TALENT POOL Polisseur confirmé H/F', 'Sales Associates - Future Opportunities', 'Vivier - Délégué Pharmaceutique - Région Centre',
    'Boots UK Pharmacist - Register your interest', 'MECCA Joondalup - Host Expression of Interest',
    'Store Keeper - Talent Pool - Hafr Albatin OR AlKhafji OR Jubail', 'Future Opportunities within our IT & Digital Teams',
    'Future Opportunities - Sales Team', 'Talent Pool – Store Team', 'Vivier - Équipe boutique', 'Design Expression of Interest | Honey Birdette HQ (Sydney)',
    'Expressions of Interest - Canberra Management', 'Styliste - Sur appel (Opportunités futures) // On-call Stylist (Future Opportunities)',
    // un mot inconnu de tout vocabulaire, un contrat, un public : jamais un retrait
    'Future Opportunities - Florist', 'Future Opportunities - Perfumer', 'Talent Pool - Nurse', 'Talent Pool - Security',
    'Talent Pool - Stagiaire', 'Vivier Alternance', 'Talent Pool - Intern', 'Future Opportunities - Graduate', 'Student Talent Community',
    'UAE National Talent Pool', 'Ru’ya Talent Community (Emiratisation)', 'Talent Pool #Squadonamission', 'キャリア登録 - Join our Talent Community', 'Talent Pool - Join our team',
    // un vrai poste qui contient le mot, et la Maison Roger Vivier
    'Talent Community Manager', 'Head of Talent Pool', 'Talent Community Partner', 'Talent Pool Sourcer', 'Chargé(e) de vivier',
    'Gestionnaire de vivier', 'Animatrice vivier', 'Roger Vivier', 'Roger-Vivier', 'Commission Sales Associate - Womens Shoes/Roger Vivier, Full Time - 59th Street',
    // l'intitulé tel que l'adaptateur le rend (Beiersdorf, 02/10/2026)
    'Vivier - D&#233;l&#233;gu&#233; Pharmaceutique - R&#233;gion Centre',
  ])('publié : « %s »', (title) => {
    expect(spontaneousApplicationProof(job(title, { company: 'Roger Vivier', location: 'London, UK', country: 'GB' }))).toBeNull();
  });

  it('le lieu et la Maison sont ceux de l\'offre : sans eux, une ville reste un mot inconnu et l\'offre reste publiée', () => {
    expect(spontaneousApplicationProof(job('Future Opportunities - (Boston)'))).toBeNull();
    expect(spontaneousApplicationProof(job('Future Opportunities - (Boston)', { company: 'Mejuri', location: 'Boston' })))
      .toEqual({ kind: 'TALENT_POOL', label: 'future opportunities', remainder: 'boston' });
  });

  it('un intitulé démesuré est lu en temps borné', () => {
    const started = Date.now();
    expect(spontaneousApplicationProof(job('Talent Pool ' + '- Paris '.repeat(50_000), { location: 'Paris' }))).toMatchObject({ kind: 'TALENT_POOL' });
    expect(Date.now() - started).toBeLessThan(1_500);
  });
});

/**
 * D-522 §6 (03/10/2026) — variantes MESURÉES sur les offres que la levée des retenues Workday et le portail L'Oréal feraient
 * publier (`audits/2026-10-03/stock-exceptions/workday-marques/vocabulaire-d511-d512.md`), et sur les offres actives.
 */
describe('D-522 §6 : variantes mesurées de D-511 et D-512', () => {
  it('candidature spontanée : « Send us your CV », « Inviaci il tuo curriculum » (Brunello Cucinelli, 02/10/2026)', () => {
    for (const title of ['Inviaci il tuo curriculum - Send us your CV', 'Send us your CV', 'Send us your resume', 'Send Us Your Résumé']) {
      expect(spontaneousApplicationProof(job(title)), title).toMatchObject({ kind: 'TITLE_LABEL', label: 'send us your CV' });
    }
  });
  it('vivier pur : « Banco de Talentos | Tiffany&Co. Brasil » (lvmh, tiffany-oracle), « Base / Comunidad de Talentos » seuls', () => {
    for (const offre of [at('Banco de Talentos | Tiffany&Co. Brasil', 'Tiffany & Co.', 'São Paulo', 'BR'), at('Base de Talentos', "L'Oréal", 'Buenos Aires', 'AR'),
      at('Comunidad de Talentos - Bogotá', "L'Oréal", 'Bogotá', 'CO')]) {
      expect(spontaneousApplicationProof(job(offre.title, offre)), offre.title).toMatchObject({ kind: 'TALENT_POOL', label: 'banco de talentos' });
    }
  });
  it('vivier qui nomme un poste : publié (D-512), intitulés réels Swarovski, L’Oréal, MECCA, Banco de Talentos actifs', () => {
    for (const offre of [
      at('Banco de Talentos | Swarovski Brasil | Vendedores', 'Swarovski', 'Sao Paulo, BRA', 'BR'),
      at('Banco de Talentos | Swarovski Brasil | Gerentes de Loja', 'Swarovski', 'Sao Paulo, BRA', 'BR'),
      at('Base de Talentos: Data', "L'Oréal", 'Buenos Aires', 'AR'), at('Base de Talentos: Medical', "L'Oréal", 'Buenos Aires', 'AR'),
      at('Comunidad de talentos - FINANCE', "L'Oréal", 'Bogotá', 'CO'), at('Comunidad De Talentos - Comercial', "L'Oréal", 'Bogotá', 'CO'),
      at('MECCA BRANDS Expressions of Interest - Colour Specialists - New South Wales 2026', 'MECCA'),
      at('Banco de Talentos | Client Advisor São Paulo', 'Tiffany & Co.', 'São Paulo', 'BR'), at('Banco de Talentos - Estágio', 'CHANEL', 'São Paulo', 'BR'),
      at('Supervisor de Vendas - São Paulo - Banco de Talentos', 'Sephora', 'São Paulo', 'BR'),
    ]) {
      expect(spontaneousApplicationProof(job(offre.title, offre)), offre.title).toBeNull();
    }
  });
  it('pièges : « CV Specialist », « Talent Bank Manager », « Banco de Talentos Coordinator », « Send us your CV Reviewer » restent publiés', () => {
    for (const title of ['CV Specialist', 'Talent Bank Manager', 'Banco de Talentos Coordinator', 'Send us your CV Reviewer', 'Database Talent Analyst',
      'Curriculum Developer', 'Inviaci il tuo curriculum vitae manager']) {
      expect(spontaneousApplicationProof(job(title)), title).toBeNull();
    }
  });
});
