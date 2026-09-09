import { describe, expect, it } from 'vitest';
import { classifyFunction, classifyJob, classifyProgramType, classifySeniority, isAiRelated, JOB_FUNCTIONS, BOOTSTRAP_TAXONOMY } from './taxonomy.js';
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
    ['Make-Up Artist', 'beauty-services'],
    ['Conseillère Beauté', 'beauty-advisor'],
    ['Fragrance Specialist', 'beauty-advisor'],
    // Un superviseur d'entrepôt n'est PAS un directeur de boutique : titres
    // réels mesurés en prod le 2026-09-07 (19 offres mal classées).
    ['Warehouse Supervisor', 'supply-chain-logistics'],
    ['Warehouse Supervisor II', 'supply-chain-logistics'],
    ['Floor Supervisor Warehouse', 'supply-chain-logistics'],
    ['Shift Lead, Warehouse', 'supply-chain-logistics'],
    ['Distribution Centre Team Leader - Day Shift', 'supply-chain-logistics'],
    ['Distribution Supervisor - Late Shift', 'supply-chain-logistics'],
    ['Superviseur Logistique Produits Finis (H/F)', 'supply-chain-logistics'],
    ['Logistics Supervisor - all departments (m/f/d)', 'supply-chain-logistics'],
    ['Warehouse Team Leader - PM Shift', 'supply-chain-logistics'],
    ['Store Manager', 'retail-store-management'],
    ['Responsabile di Negozio - Como', 'retail-store-management'],
    ['Gestionnaire Référentiel Produits H/F', 'supply-chain-logistics'],
    ['Coordinateur.trice Énergie et Fluides – Bâtiments', 'admin-facilities'],
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
    ['Graphic Designer', 'design-creation'],
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
    // Audit I-3 (2 × 300 offres jugées) — chaque titre est un cas réel de prod
    ['Stylist 16 hours', 'retail-client-advisor'],
    ['Full-Time Stylist (Bloomingdales - North Michigan)', 'retail-client-advisor'],
    ['Designated Selling Associate - Luxottica', 'retail-client-advisor'],
    ['Selling Associate - Womens Shoes', 'retail-client-advisor'],
    ['Athlete III', 'retail-client-advisor'],
    ['Kundenberater (m/w/d)', 'retail-client-advisor'],
    ['Weihnachtsaushilfe (m/w/d)', 'retail-client-advisor'],
    ['Temporary Associate', 'retail-client-advisor'],
    ['Associate III', 'retail-client-advisor'],
    ['Retail Experience Intern', 'retail-client-advisor'],
    ['Jewellery Expert', 'retail-client-advisor'],
    ['Welcome Host Zürich', 'retail-client-advisor'],
    ['Customer Host (4 HRS)', 'retail-client-advisor'],
    ['Master Stylist', 'beauty-advisor'],
    ['Elite Stylist', 'beauty-advisor'],
    ['Brow Waxing Expert', 'beauty-services'],
    ['Specialty Artist - MAC', 'beauty-advisor'],
    ['Lead Piercer (Part-Time)', 'beauty-advisor'],
    ['MECCA Chadstone - Skin Specialist', 'beauty-advisor'],
    ['CDI - Sellier Maroquinier', 'atelier-craft'],
    ['Joaillier SAV (H/F)', 'atelier-craft'],
    ['Incastonatore', 'atelier-craft'],
    ['CDI Sculpteur (H/F)', 'atelier-craft'],
    ['Spécialiste métier Polissage', 'atelier-craft'],
    ['Constructeur Mouvements (Le Sentier)', 'atelier-craft'],
    ['CDD - Metteur aux Bains (H/F)', 'atelier-craft'],
    ['Senior Machine Learning Engineer, ITC', 'it-data'],
    ['Data Engineer (H/F) STAGE TALENT DAY', 'it-data'],
    ['Senior Data Scientist, Growth', 'it-data'],
    ['Manufacturing Operations Semantic/Data Architect', 'it-data'],
    ['Senior Director, Enterprise Architecture - AI & Data', 'it-data'],
    ["Apprentissage d'informaticien∙ne CFC", 'it-data'],
    ['Solution Architect, WFM Systems', 'it-data'],
    ['Task Associate', 'retail-operations'],
    ['Seasonal Retail Stock - Fashion Valley', 'retail-operations'],
    ['Full Time Operation Associate', 'retail-operations'],
    ['Boutique Administrator', 'retail-operations'],
    ['Stock Executive', 'retail-operations'],
    ['Cajeros/as Part Time', 'retail-operations'],
    ['Operations Leader - Full Time', 'retail-operations'],
    ['Asset Protection Investigator', 'retail-operations'],
    ['TEAM MANAGER', 'retail-store-management'],
    ['Storemanager (m/w/d)', 'retail-store-management'],
    ['Assistent Shopmanager', 'retail-store-management'],
    ['Responsable des Ventes H/F', 'retail-store-management'],
    ['Responsável de Turno', 'retail-store-management'],
    ['Souschef', 'retail-store-management'],
    ['DIRECTEUR/RICE ADJOINT/E', 'retail-store-management'],
    ['Assistant Store Leader', 'retail-store-management'],
    ['Restaurant Supervisor, Full Time - Newport Beach', 'hospitality'],
    ['Restaurant Host - Marketplace Café', 'hospitality'],
    ['Crew Member Kitchen - 1600 Lully', 'hospitality'],
    ['Sous-chef', 'hospitality'],
    ['CDI - Contrôleur de gestion industriel (H/F)', 'finance'],
    ['Fashion & Accessories Manufacturing Project Controller', 'finance'],
    ['Trésorier Groupe H/F', 'finance'],
    ['Account Payable Trainee - Project management & Process Improvement', 'finance'],
    ['STAGE - Assistant(e) Sales Merchandiser Fashion Accessoires', 'merchandising-buying'],
    ['Directrice de Collection Ceinture', 'merchandising-buying'],
    ['Acheteur Indirect (H/F)', 'supply-chain-logistics'],
    ["Gestionnaire d'ordonnancement (H/F)", 'supply-chain-logistics'],
    ['Senior Manager, Client Experience', 'crm-clienteling'],
    ['Clienteling Product Management Intern', 'crm-clienteling'],
    ['Stage - Assistant(e) Clienteling International', 'crm-clienteling'],
    ['Client Contact Consultant, Fixed Term, E-Commerce', 'customer-service'],
    ['E-Boutique Client Advisor', 'customer-service'],
    ['Client Success Representative (Remote, Contract)', 'customer-service'],
    ['Regional Online Retail Director', 'ecommerce-digital'],
    ['Operations Supervisor ECommerce - Evenings', 'ecommerce-digital'],
    ['Cleaning Technician (FTC - Workload Support)', 'admin-facilities'],
    ['PR Assistant Manager', 'marketing-communication'],
    ['Coordinator, Promotions', 'marketing-communication'],
    ['People & Culture In-Store Business Partner', 'hr-talent'],
    ['CDI - Développeur Peaux Précieuses', 'product-development-rd'],
    ['Senior Manager, Legal Operations and Innovation', 'legal-compliance'],
    ['B2B Operations Specialist', 'wholesale-b2b'],
    ['National Field Force Manager', 'wholesale-b2b'],
    ['Temp Assistant Manager, Network Development', 'strategy-management'],
    ['Assistant Manager, High Jewelry Assortment', 'merchandising-buying'],
    ['Van Cleef & Arpels Client Insights Assistant Manager', 'crm-clienteling'],
    ['Tech Team Lead', 'it-data'],
    ['Responsabile Qualità HCI', 'manufacturing-quality'],
    ['Chef.fe d\'équipe (Temps plein)', 'retail-store-management'],
  ])('%s → %s', (title, expected) => {
    expect(classifyFunction(title)).toBe(expected);
  });

  it('le département de salon ou de boutique prime sur un titre générique (audit I-3)', () => {
    expect(classifyFunction('Stylist', 'Salon Professionals')).toBe('beauty-services');
    expect(classifyFunction('Stylist', undefined)).toBe('design-creation');
    expect(classifyFunction('General Manager', 'Retail Management')).toBe('retail-store-management');
    expect(classifyFunction('General Manager', undefined)).toBe('strategy-management');
    expect(classifyFunction('Coordinator', 'Retail Associates')).toBe('retail-client-advisor');
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
    expect(JOB_FUNCTIONS.every((f) => BOOTSTRAP_TAXONOMY.groups.has(f.family))).toBe(true);
  });
});

describe('classifySeniority — l’ordre des tests fait la règle', () => {
  it.each([
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
    ['Project Manager', undefined, null],
    ['Chef de projet CRM', undefined, null],
    ['Senior Client Advisor', undefined, 'SENIOR'],
    ['Expert Horloger', undefined, null],
    ['Junior Designer', undefined, 'JUNIOR'],
    ['Assistant Chef de Produit', undefined, 'JUNIOR'],
    ['Sales Associate', undefined, null],
    ['Sales Assistant', undefined, null],
    ['Client Advisor', undefined, null],
    ['Maroquinier', undefined, null],
    // Audit I-3 : un coordinateur, un specialist, un expert ne managent pas
    ['VM Coordinator', undefined, null],
    ['Coordinateur.rice Données', undefined, null],
    ['Retail Operations Specialist', undefined, null],
    ['Brow Waxing Expert', undefined, null],
    ['CRO Manager', undefined, null],
    ['Assistant Store Leader', undefined, 'MANAGER'],
    ['Retail General Manager, Melrose Ave', undefined, 'DIRECTOR'],
  ])('%s → %s', (title, _unused, expected) => {
    expect(classifySeniority(title)).toBe(expected);
  });

  it('un General Manager de magasin dirige une boutique, pas une entreprise (département Retail Management)', () => {
    expect(classifySeniority('General Manager', 'Retail Management')).toBe('DIRECTOR');
    expect(classifySeniority('General Manager', undefined)).toBe('EXECUTIVE');
  });

  /**
   * La séniorité ne classe plus AUCUN dispositif : un stagiaire n'est pas un
   * niveau, il est un `programType`. Elle rend le niveau réel de l'intitulé —
   * null quand le titre ne précise aucun niveau.
   */
  it('un intitulé de programme ne produit plus de séniorité de programme', () => {
    for (const title of ['Stage - Assistant Manager', 'Alternance - Chargé de communication', 'V.I.E. Finance']) {
      expect(['INTERNSHIP', 'APPRENTICESHIP', 'GRADUATE']).not.toContain(classifySeniority(title));
    }
  });
});

/**
 * Les DISPOSITIFS, sortis de la séniorité le 2026-09-08 : ils polluaient
 * 4 296 offres. Les motifs multilingues éprouvés (WERKSTUDENT, LEHRSTELLE,
 * AZUBI, NEOLAUREAT…) les servent désormais.
 */
describe('classifyProgramType', () => {
  it.each([
    ['Stage - Assistant Manager Boutique', 'INTERNSHIP'],
    ['Internship - Marketing', 'INTERNSHIP'],
    ['Werkstudent Marketing (m/w/d)', 'INTERNSHIP'],
    ['Alternance - Chargé de communication', 'APPRENTICESHIP'],
    ['Apprentice Watchmaker', 'APPRENTICESHIP'],
    ['Lehrstelle als Uhrmacher∙in EFZ', 'APPRENTICESHIP'],
    ['Apprendista Addetto al Taglio', 'APPRENTICESHIP'],
    ['Auszubildender zum Werkzeugmechaniker 2027', 'APPRENTICESHIP'],
    ['Stagaire Excellence Opérationnelle', 'INTERNSHIP'],
    ['Graduate Program - Retail', 'GRADUATE_PROGRAM'],
    ['Management Trainee', 'GRADUATE_PROGRAM'],
    ['V.I.E. Finance - New York', 'VIE'],
  ])('%s → %s', (title, expected) => {
    expect(classifyProgramType(title)).toBe(expected);
  });

  it('rend null quand l’intitulé ne nomme aucun dispositif', () => {
    expect(classifyProgramType('Conseiller de vente')).toBeNull();
    expect(classifyProgramType('Directeur de boutique')).toBeNull();
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

  it('ignore les clauses d’entreprise, le code de l’Iowa et la saison italienne (audit I-3)', () => {
    expect(isAiRelated('Warehouse Technician', 'We do not employ machine learning technologies during this phase of the process.')).toBe(false);
    expect(isAiRelated('Account Executive', 'AI at Toast: We believe learning new AI tools empowers us to do our best work.')).toBe(false);
    expect(isAiRelated('Vendeur', "L'utilisation de l'Intelligence Artificielle peut être utilisée à des fins de présélection.")).toBe(false);
    expect(isAiRelated('Sales Advisor', 'We do not use any personal information to train any AI models.')).toBe(false);
    expect(isAiRelated('Sales Associate', 'Altoona, IA, USA. Full time.')).toBe(false);
    expect(isAiRelated('Visual Merchandiser', 'Campagna vendite AI 2027, showroom Milano.')).toBe(false);
    expect(isAiRelated('Junior Global Pricing Manager', 'University degree in economics, data science or statistics.')).toBe(false);
    expect(isAiRelated('Operations Manager', 'Resolve issues with Booster, My Copilot, and other systems.')).toBe(false);
    expect(isAiRelated('Machine Learning Engineer', 'You build and ship models.')).toBe(true);
    expect(isAiRelated('Data Scientist', 'You apply data science to pricing. Strong background in data science and statistics.')).toBe(true);
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

  it('ne prend ni « in-store events », ni « apply via Workday », ni « territoire français » (audit I-3)', () => {
    expect(extractSkills('You will support in-store events and training events.')).not.toContain('Événementiel');
    expect(extractSkills('Event management and event planning experience required.')).toContain('Événementiel');
    expect(extractSkills('Current employees, apply via your Workday account.')).not.toContain('Workday');
    expect(extractSkills('Experience administering Workday HCM.')).toContain('Workday');
    expect(extractSkills('Nocibé, réseau de plus de 550 points de vente répartis sur tout le territoire français.')).not.toContain('Français');
    expect(extractSkills('Customers buying gifts will appreciate your help.')).not.toContain('Achats');
    expect(extractSkills('Hair styling and cutting techniques.')).not.toContain('Stylisme');
    expect(extractSkills('Build a sustainable, vibrant House.')).not.toContain('Développement durable');
    expect(extractSkills('1er réseau de franchise en optique.')).not.toContain('Franchise');
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
