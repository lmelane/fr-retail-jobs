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
