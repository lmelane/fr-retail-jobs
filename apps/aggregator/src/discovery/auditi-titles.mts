import { classifyFunction, classifySeniority, isAiRelated } from '../normalize/taxonomy.js';
import { extractSkills } from '../normalize/skills.js';

/**
 * Audit I — Axe 3 : preuve d'exécution, titre par titre, des règles mises en
 * cause par l'échantillon. Aucune base : le code seul.
 * Usage : npx tsx src/discovery/auditi-titles.mts
 */
const TITLES: ReadonlyArray<[string, string | undefined]> = [
  ['Stylist', 'Salon Professionals'],
  ['Master Stylist', 'Salon Professionals'],
  ['Stylist 16 hours', undefined],
  ['Full-Time Stylist (Bloomingdales - North Michigan)', undefined],
  ['Designated Selling Associate - Luxottica', undefined],
  ['Selling Associate - Womens Shoes', undefined],
  ['Senior Machine Learning Engineer, ITC', undefined],
  ['Machine Learning Engineer', undefined],
  ['General Manager', 'Retail Management'],
  ['Task Associate', 'Retail Associates'],
  ['TEAM MANAGER', undefined],
  ['Storemanager (m/w/d)', undefined],
  ['Kundenberater (m/w/d)', undefined],
  ['Weihnachtsaushilfe (m/w/d)', undefined],
  ['Brow Waxing Expert', undefined],
  ['Specialty Artist - MAC', undefined],
  ['Athlete III', undefined],
  ['Souschef', undefined],
  ['Restaurant Host - Marketplace Café', undefined],
  ['Acheteur Indirect (H/F)', undefined],
  ['B2B Operations Specialist', undefined],
  ['STAGE - Assistant(e) Sales Merchandiser Fashion Accessoires', undefined],
  ['Directrice de Collection Ceinture H/F', undefined],
  ['Responsable des Ventes H/F', undefined],
  ['Boutique Administrator', undefined],
  ['Stock Executive', undefined],
  ['Client Experience Manager', undefined],
  ['Senior Manager, Client Experience', undefined],
  ['Clienteling Product Management Intern', undefined],
  ['CDI - Développeur Peaux Précieuses (H/F)', undefined],
  ['Data Engineer (H/F) STAGE TALENT DAY', undefined],
  ['Account Payable Trainee - Project management & Process Improvement', undefined],
  ['Manufacturing Operations Semantic/Data Architect', undefined],
  ['Data Scientist Intern', undefined],
  ['Financial Controller', undefined],
  ['CDI - Contrôleur de gestion industriel (H/F)', undefined],
  ['Fashion & Accessories Manufacturing Project Controller', undefined],
  ['Joaillier SAV (H/F)', undefined],
  ['Cleaning Technician', undefined],
  ['E-Boutique Client Advisor', undefined],
  ['Tech Team Lead', undefined],
  ['PR Assistant Manager', undefined],
  ['Assistant Manager, High Jewelry Assortment', undefined],
  ['Temp Assistant Manager, Network Development', undefined],
  ['Regional Online Retail Director', undefined],
  ['Online Retail Operations Coordinator', undefined],
  ['Operations Supervisor ECommerce - Evenings', undefined],
  ['Client Contact Consultant, Fixed Term, E-Commerce', undefined],
  ['Sales Manager', undefined],
  ['Senior Area Sales Manager (Central)', undefined],
  ['Efore - Global Sales Director', undefined],
  ['Apprentissage d\'informaticien∙ne CFC', undefined],
  ['Lehrstelle als Uhrmacher∙in EFZ', undefined],
  ['Apprendista Addetto al Taglio', undefined],
  ['Incastonatore', undefined],
  ['Responsabile Qualità HCI', undefined],
  ['ADETTO/A ALLA PREPARAZIONE', undefined],
  ['Gestionnaire d\'ordonnancement (H/F)', undefined],
  ['People & Culture In-Store Business Partner', undefined],
  ['Cajeros/as Part Time', undefined],
  ['La Mer Szépségtanácsadó', undefined],
  ['Responsável de Turno', undefined],
  ['Crew Member Kitchen - 1600 Lully', undefined],
  ['Coordinator, Promotions', undefined],
  ['Operations Leader - Full Time', 'Retail'],
  ['Welcome Host Zürich', undefined],
  ['Back-office Admin', undefined],
  ['MD Manager', undefined],
  ['Planner', undefined],
  ['CDI Sculpteur (H/F)', undefined],
  ['Jewellery Expert', undefined],
  ['Responsable Retail', undefined],
  ['Retail Experience Intern', undefined],
  ['Full Time Operation Associate', undefined],
  ['Salesforce Technology Support Specialist', undefined],
  ['Seasonal Retail Stock - Fashion Valley', undefined],
];

console.log('title | department | fn | seniority');
for (const [t, d] of TITLES) console.log(`${t} | ${d ?? ''} | ${classifyFunction(t, d) ?? 'NULL'} | ${classifySeniority(t)}`);

console.log('\n--- seniority : même métier, deux langues');
for (const t of ['Sales Associate', 'Conseiller de vente H/F', 'Client Advisor', 'Vendeur H/F', 'Sales Assistant', 'Sales Advisor', 'Assistant Store Leader', 'VM Coordinator', 'Operations Coordinator - Boston', 'Stock Coordinator', 'CRO Manager', 'Stagaire Excellence Opérationnelle', 'Directeur Adjoint de Boutique', 'ESG Specialist', 'Retail Operations Specialist', 'Skin Care Expert (m/w/x)']) console.log(`${t} | ${classifySeniority(t)}`);

console.log('\n--- IA : phrases de contrôle');
const AI_CASES: ReadonlyArray<[string, string]> = [
  ['Junior Global Pricing Manager', 'University degree (M. Sc., B.Sc.) in business administration, management and data science or statistics.'],
  ['Operations Manager', 'Act as a liaison for IT-related tickets, including issues with Booster, My Copilot, and other systems.'],
  ['Senior Project Manager', 'Stay current on emerging solutions (AI, automation, data analytics, cybersecurity etc.) and assess their potential impact.'],
  ['Client Strategy Manager', 'An experienced team blending activation, Client & Sales Experience, Marketing Science, Data & AI, etc.'],
  ['Coordinator, Store Development', 'Leverage AI and digital tools to improve productivity, efficiency, and ways of working.'],
  ['Sales Advisor', 'We use artificial intelligence in our recruitment process to screen applications.'],
  ['Sales Advisor', 'Please refrain from using AI tools during interviews.'],
  ['Stagiaire Projets IA RH', 'Participer à la conception d\'un tuteur basé sur l\'intelligence artificielle.'],
];
for (const [t, d] of AI_CASES) console.log(`${isAiRelated(t, d)} | ${t} | ${d.slice(0, 90)}`);

console.log('\n--- Langues : phrases de contrôle');
const LANG_CASES = [
  'Nocibé, réseau de plus de 550 points de vente répartis sur tout le territoire français, se distingue par une approche holistique.',
  'Fursac créé sa vision exigeante d\'un vestiaire réfléchi, ouvert, français. Depuis 1973.',
  'A French luxury house founded in 1837, we are looking for a Sales Associate.',
  'Italian brand with strong heritage. Experience in retail required.',
  'Experience with French market – retail experience is highly appreciated.',
  'Anglais courant demandé.',
  'Fluent in Italian and English; French is a plus.',
];
for (const s of LANG_CASES) console.log(`${JSON.stringify(extractSkills(s).filter((k) => ['Anglais', 'Français', 'Italien', 'Mandarin', 'Espagnol', 'Allemand'].includes(k)))} | ${s.slice(0, 90)}`);
