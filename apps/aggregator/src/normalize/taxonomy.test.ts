import { describe, expect, it } from 'vitest';
import { classifyFunction, classifyJob, classifySeniority, isAiRelated, JOB_FUNCTIONS } from './taxonomy.js';
import { extractSkills } from './skills.js';

describe('classifyFunction — la famille de métier du secteur, depuis le titre', () => {
  it.each([
    // Retail — les intitulés réels des flux (LVMH, Kering, Richemont, ELC, Sephora, Foot Locker…)
    ['Client Advisor', 'retail-client-advisor'],
    ['Senior Client Advisor - Bond Street', 'retail-client-advisor'],
    ['Sales Associate', 'retail-client-advisor'],
    ['Conseiller de vente (H/F) - CDI - Paris', 'retail-client-advisor'],
    ['Vendeur/Vendeuse Polyvalent(e)', 'retail-client-advisor'],
    ['Addetto alle vendite - Milano', 'retail-client-advisor'],
    ['Verkäufer (m/w/d) Teilzeit', 'retail-client-advisor'],
    ['Brand Ambassador', 'retail-client-advisor'],
    ['Style Advisor', 'retail-client-advisor'],
    ['Beauty Advisor - Sephora Champs-Élysées', 'beauty-advisor'],
    ['Make-Up Artist', 'beauty-advisor'],
    ['Conseillère Beauté', 'beauty-advisor'],
    ['Fragrance Specialist', 'beauty-advisor'],
    ['Store Manager', 'retail-store-management'],
    ['Assistant Store Manager', 'retail-store-management'],
    ['Boutique Director', 'retail-store-management'],
    ['Responsable de Boutique H/F', 'retail-store-management'],
    ['Directeur de magasin', 'retail-store-management'],
    ['Department Manager - Leather Goods', 'retail-store-management'],
    ['Team Leader', 'retail-store-management'],
    ['Counter Manager', 'retail-store-management'],
    ['Area Manager - Middle East', 'retail-area-management'],
    ['Regional Director Retail', 'retail-area-management'],
    ['Head of Retail Europe', 'retail-area-management'],
    ['District Manager', 'retail-area-management'],
    ['Stock Associate', 'retail-operations'],
    ['Stockroom Assistant', 'retail-operations'],
    ['Cashier', 'retail-operations'],
    ['Hôte de caisse', 'retail-operations'],
    ['Retail Operations Coordinator', 'retail-operations'],
    ['Loss Prevention Officer', 'retail-operations'],
    ['Visual Merchandiser', 'visual-merchandising'],
    ['Regional Visual Merchandising Manager', 'visual-merchandising'],
    ['Window Dresser', 'visual-merchandising'],
    // Corporate
    ['Merchandiser Femme', 'merchandising-buying'],
    ['Buyer - Accessories', 'merchandising-buying'],
    ['Merchandise Planner', 'merchandising-buying'],
    ['Chef de produit Maroquinerie', 'merchandising-buying'],
    ['Wholesale Manager EMEA', 'wholesale-b2b'],
    ['Key Account Manager', 'wholesale-b2b'],
    ['Travel Retail Sales Executive', 'wholesale-b2b'],
    ['CRM Manager', 'crm-clienteling'],
    ['Clienteling Specialist', 'crm-clienteling'],
    ['Client Development Manager', 'crm-clienteling'],
    ['E-commerce Manager', 'ecommerce-digital'],
    ['Site Merchandiser', 'ecommerce-digital'],
    ['Digital Marketing Manager', 'ecommerce-digital'],
    ['Omnichannel Project Manager', 'ecommerce-digital'],
    ['Marketing Manager', 'marketing-communication'],
    ['Press Officer', 'marketing-communication'],
    ['Social Media Manager', 'marketing-communication'],
    ['Chargé de communication', 'marketing-communication'],
    ['Graphic Designer', 'marketing-communication'],
    ['Fashion Designer - Womenswear', 'design-creation'],
    ['Styliste', 'design-creation'],
    ['Creative Director', 'design-creation'],
    ['Textile Designer', 'design-creation'],
    ['Product Development Manager', 'product-development-rd'],
    ['R&D Formulation Scientist', 'product-development-rd'],
    ['Regulatory Affairs Specialist', 'product-development-rd'],
    ['Packaging Development Engineer', 'product-development-rd'],
    ['Maroquinier', 'atelier-craft'],
    ['Watchmaker', 'atelier-craft'],
    ['Horloger', 'atelier-craft'],
    ['Joaillier', 'atelier-craft'],
    ['Sertisseur', 'atelier-craft'],
    ['Couturière', 'atelier-craft'],
    ['Tailor', 'atelier-craft'],
    ['Opérateur de production maroquinerie', 'atelier-craft'],
    ['Production Planner', 'supply-chain-logistics'],
    ['Quality Engineer', 'manufacturing-quality'],
    ['Technicien de maintenance', 'manufacturing-quality'],
    ['Supply Chain Manager', 'supply-chain-logistics'],
    ['Préparateur de commandes', 'supply-chain-logistics'],
    ['Warehouse Associate', 'supply-chain-logistics'],
    ['Logistics Coordinator', 'supply-chain-logistics'],
    ['Financial Controller', 'finance'],
    ['Comptable', 'finance'],
    ['FP&A Analyst', 'finance'],
    ['HR Business Partner', 'hr-talent'],
    ['Talent Acquisition Specialist', 'hr-talent'],
    ['Chargé de recrutement', 'hr-talent'],
    ['Retail Trainer', 'hr-talent'],
    ['Data Analyst', 'it-data'],
    ['Software Engineer', 'it-data'],
    ['SAP Consultant', 'it-data'],
    ['IT Support Technician', 'it-data'],
    ['Legal Counsel', 'legal-compliance'],
    ['Juriste droit des affaires', 'legal-compliance'],
    ['Brand Protection Manager', 'legal-compliance'],
    ['Sustainability Manager', 'sustainability'],
    ['Chargé de mission RSE', 'sustainability'],
    ['Customer Service Advisor', 'customer-service'],
    ['Conseiller clientèle à distance', 'customer-service'],
    ['Chef de partie', 'hospitality'],
    ['Sommelier', 'hospitality'],
    ['Executive Assistant', 'admin-facilities'],
    ['Assistante de direction', 'admin-facilities'],
    ['Office Manager', 'admin-facilities'],
    ['Strategy Manager', 'strategy-management'],
    ['Business Analyst', 'strategy-management'],
    ['Chief Executive Officer', 'strategy-management'],
    ['Chef de projet', 'strategy-management'],
    // Les intitulés réels restés non classés au premier rejeu (12 000 offres prod)
    ['Addett* Vendite CX Team Member', 'retail-client-advisor'],
    ['Collaborateur chargé des ventes', 'retail-client-advisor'],
    ['Empleado/a de ventas', 'retail-client-advisor'],
    ['Store Worker', 'retail-client-advisor'],
    ['Butiksmedarbejder over 18 år - dagtimer', 'retail-client-advisor'],
    ['Conseiller·ère de vente - Liège', 'retail-client-advisor'],
    ['Watches and Fine Jewellery Advisor', 'retail-client-advisor'],
    ['客户顾问 - 北京', 'retail-client-advisor'],
    ['Schichtleiter (m/w/d)', 'retail-store-management'],
    ['Deputy Head of Boutique', 'retail-store-management'],
    ['Responsables de boutique', 'retail-store-management'],
    ['Employé Responsable Ouverture Fermeture', 'retail-store-management'],
    ['Skincare Therapist', 'beauty-advisor'],
    ['Beauty Confidant', 'beauty-advisor'],
    ['Employé de rayon maquillage', 'beauty-advisor'],
    ['Chargé.e de stock', 'retail-operations'],
    ['Sous-chef', 'hospitality'],
    ['Researcher - Executive Search', 'hr-talent'],
    ['People Business Partner', 'hr-talent'],
    ['Metteur au point', 'atelier-craft'],
    ['Mechanic - 1st Shift', 'manufacturing-quality'],
    ['Distribution Planner', 'supply-chain-logistics'],
    ['Directeur.rice Régional.e Sud', 'retail-area-management'],
    ['Assistant.e Réseaux Sociaux - Stage 6 mois', 'marketing-communication'],
  ])('%s → %s', (title, expected) => {
    expect(classifyFunction(title)).toBe(expected);
  });

  it('lit le département quand le titre est muet', () => {
    expect(classifyFunction('Assistant(e) H/F', 'Supply Chain')).toBe('supply-chain-logistics');
    expect(classifyFunction('Coordinator', 'Retail')).toBe('retail-client-advisor');
    expect(classifyFunction('Coordinator', 'Visual Merchandising')).toBe('visual-merchandising');
  });

  it('ne devine jamais : titre et département muets → null', () => {
    expect(classifyFunction('Poste à pourvoir')).toBeNull();
    expect(classifyFunction('', null)).toBeNull();
    expect(classifyFunction(undefined, undefined)).toBeNull();
  });

  it('le référentiel a des clés uniques et une famille chacune', () => {
    const keys = JOB_FUNCTIONS.map((f) => f.key);
    expect(new Set(keys).size).toBe(keys.length);
    expect(JOB_FUNCTIONS.every((f) => ['retail', 'craft', 'corporate'].includes(f.family))).toBe(true);
  });
});

describe('classifySeniority — l’ordre des tests fait la règle', () => {
  it.each([
    ['Stage - Assistant Manager Boutique', undefined, 'INTERNSHIP'],
    ['Internship - Marketing', undefined, 'INTERNSHIP'],
    ['Alternance - Chargé de communication', undefined, 'APPRENTICESHIP'],
    ['Apprentice Watchmaker', undefined, 'APPRENTICESHIP'],
    ['Graduate Program - Retail', undefined, 'GRADUATE'],
    ['V.I.E. Finance - New York', undefined, 'GRADUATE'],
    ['Management Trainee', undefined, 'GRADUATE'],
    ['Chief Marketing Officer', undefined, 'EXECUTIVE'],
    ['VP Retail Americas', undefined, 'EXECUTIVE'],
    ['Managing Director', undefined, 'EXECUTIVE'],
    ['Directeur Général', undefined, 'EXECUTIVE'],
    ['Store Director', undefined, 'DIRECTOR'],
    ['Head of CRM', undefined, 'DIRECTOR'],
    ['Directrice de boutique', undefined, 'DIRECTOR'],
    ['Store Manager', undefined, 'MANAGER'],
    ['Senior Store Manager', undefined, 'MANAGER'],
    ['Responsable de boutique', undefined, 'MANAGER'],
    ['Team Leader', undefined, 'MANAGER'],
    ['Senior Product Manager', undefined, 'SENIOR'],
    ['Project Manager', undefined, 'MID'],
    ['Chef de projet CRM', undefined, 'MID'],
    ['Senior Client Advisor', undefined, 'SENIOR'],
    ['Expert Horloger', undefined, 'SENIOR'],
    ['Junior Designer', undefined, 'JUNIOR'],
    ['Assistant Chef de Produit', undefined, 'JUNIOR'],
    ['Sales Associate', undefined, 'JUNIOR'],
    ['Client Advisor', undefined, 'MID'],
    ['Maroquinier', undefined, 'MID'],
  ])('%s → %s', (title, contract, expected) => {
    expect(classifySeniority(title, contract)).toBe(expected);
  });

  it('lit le contrat normalisé quand le titre ne dit rien', () => {
    expect(classifySeniority('Chargé de communication', 'Stage')).toBe('INTERNSHIP');
    expect(classifySeniority('Chargé de communication', 'Alternance')).toBe('APPRENTICESHIP');
    expect(classifySeniority('Analyst', 'V.I.E.')).toBe('GRADUATE');
    expect(classifySeniority('Analyst', 'CDI')).toBe('MID');
  });
});

describe('isAiRelated — sigles en capitales strictes, expressions longues toutes langues', () => {
  it('détecte les intitulés et textes IA', () => {
    expect(isAiRelated('AI Product Manager')).toBe(true);
    expect(isAiRelated('Data Scientist', 'Vous construisez des modèles de machine learning.')).toBe(true);
    expect(isAiRelated('Chef de projet IA')).toBe(true);
    expect(isAiRelated('Marketing Manager', 'Experience with generative AI tools (ChatGPT, Copilot) is a plus.')).toBe(true);
  });

  it("ne confond pas « j'ai » ni les capitales d'un texte en majuscules", () => {
    expect(isAiRelated('Vendeur', "J'ai envie de rejoindre une Maison.")).toBe(false);
    expect(isAiRelated('VENDEUR', "VOUS AVEZ L'ENVIE ET J'AI LA PASSION")).toBe(false);
    expect(isAiRelated('Client Advisor', 'Mais il y a un vrai sens du service.')).toBe(false);
    expect(isAiRelated('Sales Associate - Miami', 'Retail experience required.')).toBe(false);
  });

  it('ignore les clauses sur le PROCESSUS de recrutement (mesuré : 2 700 mentions « AI » en prod, presque toutes là)', () => {
    expect(isAiRelated('Client Advisor', 'Please refrain from using AI tools, including ChatGPT, during interviews and assessments.')).toBe(false);
    expect(isAiRelated('Store Manager', 'This posting is for an existing vacancy. Artificial intelligence is not used for hiring decisions.')).toBe(false);
    expect(isAiRelated('Vendedor', 'Se abstengan de utilizar herramientas de inteligencia artificial, incluyendo ChatGPT, durante las entrevistas.')).toBe(false);
    expect(isAiRelated('Formulation Chemist', 'Le sérum est dosé en 50 ML. Vous maîtrisez la formulation.')).toBe(false);
    expect(isAiRelated('Data Product Manager', 'Au sein de la Direction Analytics & IA, vous pilotez les cas d’usage d’intelligence artificielle. Please refrain from using AI tools during interviews.')).toBe(true);
  });
});

describe('extractSkills — dictionnaire fermé, langues seulement près d’un mot de langue', () => {
  it('extrait outils, concepts et certifications', () => {
    const text = 'Maîtrise d’Excel et de Salesforce. Expérience en clienteling et CRM. Connaissance de SAP appréciée. GIA certification a plus.';
    expect(extractSkills(text)).toEqual(expect.arrayContaining(['Excel', 'Salesforce', 'Clienteling', 'CRM', 'SAP', 'GIA']));
  });

  it('une langue compte avec un mot de langue, pas comme adjectif de nationalité', () => {
    expect(extractSkills('Fluent English and Mandarin required; Arabic is a plus.')).toEqual(
      expect.arrayContaining(['Anglais', 'Mandarin', 'Arabe']),
    );
    expect(extractSkills('Join a French luxury house and an Italian brand.')).not.toEqual(
      expect.arrayContaining(['Français', 'Italien']),
    );
    expect(extractSkills('Anglais courant exigé.')).toContain('Anglais');
  });

  it('vide pour un texte vide, trié et sans doublon sinon', () => {
    expect(extractSkills('')).toEqual([]);
    expect(extractSkills(undefined)).toEqual([]);
    const skills = extractSkills('Excel, excel, EXCEL. Photoshop et Illustrator.');
    expect(skills).toEqual([...new Set(skills)]);
    expect(skills).toEqual([...skills].sort((a, b) => a.localeCompare(b, 'fr')));
  });
});

describe('classifyJob — tout en une passe', () => {
  it('assemble fonction, séniorité, retail, IA et compétences', () => {
    const result = classifyJob({
      title: 'Senior Client Advisor - Mandarin Speaker',
      department: 'Retail',
      description: 'Fluent Mandarin required. Clienteling and CRM tools (Salesforce).',
      contract: 'CDI',
    });
    expect(result.jobFunction).toBe('retail-client-advisor');
    expect(result.seniority).toBe('SENIOR');
    expect(result.isRetail).toBe(true);
    expect(result.isAiRelated).toBe(false);
    expect(result.skills).toEqual(expect.arrayContaining(['Mandarin', 'Clienteling', 'CRM', 'Salesforce']));
    expect(result.taxonomyVersion).toBeGreaterThan(0);
  });

  it('retail null quand la fonction est inconnue, false pour le corporate', () => {
    expect(classifyJob({ title: 'Poste à pourvoir' }).isRetail).toBeNull();
    expect(classifyJob({ title: 'Financial Controller' }).isRetail).toBe(false);
    expect(classifyJob({ title: 'Maroquinier' }).isRetail).toBe(false);
  });
});
