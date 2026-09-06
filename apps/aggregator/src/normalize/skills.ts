/**
 * Extraction de compétences (Catwalks Intelligence, D38) : outils, langues,
 * concepts métier et certifications, depuis le texte d'une offre, vers un
 * nom CANONIQUE (« Salesforce », « Mandarin », « Clienteling »). Dictionnaire
 * fermé, jamais de mot libre : une compétence qui n'est pas dans la liste
 * n'existe pas pour l'observatoire — c'est ce qui rend les fréquences
 * comparables d'un mois à l'autre.
 *
 * Les LANGUES ne comptent que près d'un mot de langue (« fluent », « courant »,
 * « bilingue », « niveau ») : « French luxury house » et « Italian brand » ne
 * sont pas des compétences.
 */

export type SkillKind = 'tool' | 'language' | 'concept' | 'certification';

export type SkillDefinition = { name: string; kind: SkillKind; pattern: RegExp };

const TOOLS: ReadonlyArray<[string, RegExp]> = [
  ['Excel', /\bexcel\b/i],
  ['PowerPoint', /power ?point/i],
  ['Microsoft Office', /(microsoft|ms) office|pack office|office 365|microsoft 365|suite office/i],
  ['Salesforce', /salesforce(?! commerce)/i],
  ['Salesforce Commerce Cloud', /salesforce commerce cloud|demandware|\bSFCC\b/i],
  ['SAP', /\bSAP\b(?! ?(?:\d|store))/],
  ['Power BI', /power ?bi\b/i],
  ['Tableau', /\btableau (software|desktop|server|dashboards?)\b|\btableau\b(?= (?:et|and|,|\/) ?(?:power ?bi|looker|qlik|excel))/i],
  ['Looker', /\blooker\b/i],
  ['Qlik', /\bqlik(view|sense)?\b/i],
  ['Google Analytics', /google analytics|\bGA4\b/i],
  ['Adobe Photoshop', /photoshop/i],
  ['Adobe Illustrator', /illustrator\b/i],
  ['Adobe InDesign', /indesign/i],
  ['Adobe Creative Suite', /adobe (creative )?(suite|cloud|cc)\b|suite adobe/i],
  ['Adobe Premiere', /premiere pro/i],
  ['After Effects', /after ?effects/i],
  ['Figma', /\bfigma\b/i],
  ['Sketch', /figma, sketch|sketch, figma|sketch app|\bsketch\b(?= (?:and|&|,) (?:figma|invision|adobe xd|zeplin))/i],
  ['Canva', /\bcanva\b/i],
  ['CLO 3D', /\bclo ?3d\b|\bclo\b/i],
  ['Browzwear', /browzwear|\bvstitcher\b/i],
  ['Lectra', /\blectra\b|kaledo|modaris|diamino/i],
  ['Optitex', /optitex/i],
  ['Gerber', /gerber (accumark|technology)|\baccumark\b/i],
  ['Rhino 3D', /\brhino(ceros)? ?3?d?\b/i],
  ['Blender', /\bblender\b/i],
  ['Cinema 4D', /cinema ?4d/i],
  ['SolidWorks', /solidworks/i],
  ['AutoCAD', /autocad/i],
  ['Centric PLM', /centric (plm|8)/i],
  ['PLM', /\bPLM\b/],
  ['Shopify', /shopify/i],
  ['Magento', /magento|adobe commerce/i],
  ['Cegid', /\bcegid\b/i],
  ['Oracle', /\boracle\b(?! (?:cloud hcm|hcm|recruiting))/i],
  // « apply via your Workday account » n'est pas une compétence (2 800 sur 2 976, audit I-3)
  ['Workday', /(?<!(?:via|your|through|into|in|on|to) (?:your |the )?)\bworkday\b(?! (?:account|portal|profile|career|login|log ?in|job))/i],
  ['Python', /\bpython\b/i],
  ['SQL', /\bSQL\b/],
  ['R', /\bR\b(?= (?:studio|programming|language|\/ ?python|, python|and python|et python))/],
  ['Jira', /\bjira\b/i],
  ['HubSpot', /hubspot/i],
  ['Klaviyo', /klaviyo/i],
  ['Emarsys', /emarsys/i],
  ['Braze', /\bbraze\b/i],
  ['Anaplan', /anaplan/i],
  ['Zendesk', /zendesk/i],
  ['Google Workspace', /g ?suite|google workspace/i],
  ['Notion', /\bnotion\b(?! (?:de|du|des|of|d'))/i],
  ['Cegid Y2', /\by2\b/i],
];

/** Langues : nom canonique + toutes les orthographes des annonces. */
const LANGUAGES: ReadonlyArray<[string, RegExp]> = [
  ['Anglais', /\b(english|anglais|inglese|ingl[eé]s|englisch)\b/i],
  ['Français', /\b(french|fran[cç]ais|francese|franc[eé]s|franz[öo]sisch)\b/i],
  ['Mandarin', /\b(mandarin|chinese|chinois|cinese|chino|chinesisch|putonghua)\b|中文|普通话/i],
  ['Cantonais', /\b(cantonese|cantonais)\b|粵語|广东话/i],
  ['Arabe', /\b(arabic|arabe|arabo|[aá]rabe|arabisch)\b/i],
  ['Japonais', /\b(japanese|japonais|giapponese|japon[eé]s|japanisch)\b|日本語/i],
  ['Coréen', /\b(korean|cor[eé]en|coreano|koreanisch)\b|한국어/i],
  ['Italien', /\b(italian|italien|italiano|italienisch)\b/i],
  ['Espagnol', /\b(spanish|espagnol|spagnolo|espa[nñ]ol|spanisch|castellano)\b/i],
  ['Allemand', /\b(german|allemand|tedesco|alem[aá]n|deutsch)\b/i],
  ['Portugais', /\b(portuguese|portugais|portoghese|portugu[eê]s)\b/i],
  ['Russe', /\b(russian|russe|russo|ruso|russisch)\b/i],
  ['Néerlandais', /\b(dutch|n[eé]erlandais|olandese|nederlands|niederl[äa]ndisch)\b/i],
  ['Hindi', /\bhindi\b/i],
  ['Thaï', /\b(thai|tha[iï])\b/i],
  ['Turc', /\b(turkish|turc|turco|t[üu]rkisch)\b/i],
  ['Hébreu', /\b(hebrew|h[eé]breu)\b/i],
  ['Vietnamien', /\b(vietnamese|vietnamien)\b/i],
  ['Indonésien', /\b(indonesian|bahasa|indon[eé]sien)\b/i],
];

/** Un mot de langue à moins de 70 caractères : la seule chose qui fait d'un adjectif de nationalité une compétence. */
const LANGUAGE_CUE_RE = /fluen|proficien|speak|spoken|langu|langue|bilingu|native|natif|courant|ma[iî]tris|niveau|level|parl|written|oral|\bB2\b|\bC1\b|\bC2\b|conversational|advanced|intermediate|business level|mother tongue|idioma|lingua|sprach|kenntnisse|required|requis|is a plus|un plus|a plus\b|appreciated|appr[eé]ci|mandatory|obligatoire|indispensable|would be|serait un|is a must|is required|est requis/i;
const LANGUAGE_WINDOW = 70;

const CONCEPTS: ReadonlyArray<[string, RegExp]> = [
  ['Clienteling', /clienteling/i],
  ['CRM', /\bCRM\b/],
  ['Visual merchandising', /visual merchandising|merchandising visuel/i],
  ['Merchandising', /\bmerchandising\b(?! visuel)(?<!visual )/i],
  ['Omnicanal', /omni-?channel|omnicanal/i],
  ['E-commerce', /e-?commerce|ecommerce/i],
  ['Retail', /\bretail\b/i],
  ['Wholesale', /wholesale/i],
  ['Travel retail', /travel retail|duty[- ]free/i],
  ['Achats', /\bbuying (team|office|department|role|manager|assistant|experience|process|strateg)|(experience|background) in buying|\bachats?\b/i],
  ['Développement produit', /product development|d[eé]veloppement produit/i],
  ['Supply chain', /supply ?chain/i],
  ['Logistique', /logisti(cs|que)/i],
  ['Demand planning', /demand planning|forecasting|pr[eé]vision(s)? des ventes/i],
  ['Gestion des stocks', /inventory management|gestion des stocks|stock management/i],
  ['Brand management', /brand management|gestion de marque/i],
  ['Réseaux sociaux', /social media|r[eé]seaux sociaux|instagram|tiktok/i],
  ['Marketing d’influence', /influencer|influence marketing|marketing d'influence/i],
  ['Création de contenu', /content creation|cr[eé]ation de contenu|content strategy/i],
  ['Copywriting', /copywriting|r[eé]daction/i],
  ['SEO', /\bSEO\b/],
  ['SEA / Paid media', /\bSEA\b|paid media|paid social|google ads|meta ads/i],
  ['Relations presse', /public relations|relations presse|press relations|\bPR\b/],
  // « in-store events » n'est pas de l'événementiel (455 vrais sur 17 420, audit I-3)
  ['Événementiel', /event (management|planning|coordination|production|marketing|manager|planner)|[eé]v[eé]nementiel|organisation d.[eé]v[eé]nements|gestion d.[eé]v[eé]nements/i],
  ['Analyse de données', /data analysis|analyse de donn[eé]es|data-driven|analytics/i],
  ['Reporting', /\breporting\b/i],
  ['KPI', /\bKPIs?\b/],
  ['Gestion de projet', /project management|gestion de projet|chef de projet/i],
  ['Agile / Scrum', /\bagile\b|\bscrum\b/i],
  ['UX / UI', /\bUX\b|\bUI\b|user experience/i],
  ['Contrôle qualité', /quality control|contr[oô]le qualit[eé]|quality assurance/i],
  ['Lean / Six Sigma', /\blean\b|six sigma|kaizen|amélioration continue|continuous improvement/i],
  ['Category management', /category management/i],
  ['Trade marketing', /trade marketing/i],
  ['Opérations retail', /retail operations|op[eé]rations retail|store operations/i],
  ['Expérience client', /customer experience|client experience|exp[eé]rience client|\bCX\b/i],
  ['Service client', /customer service|service client|client service/i],
  ['Négociation', /negotiat|n[eé]gociat/i],
  ['Sourcing', /\bsourcing\b/i],
  ['Formulation', /formulation/i],
  ['Affaires réglementaires', /regulatory affairs|affaires r[eé]glementaires/i],
  ['GMP / BPF', /\bGMP\b|\bBPF\b|good manufacturing/i],
  ['Packaging', /packaging/i],
  ['Horlogerie', /watchmaking|horlogerie/i],
  ['Joaillerie', /jewel(le)?ry making|joaillerie|bijouterie/i],
  ['Sertissage', /stone setting|sertissage/i],
  ['Polissage', /polishing|polissage/i],
  ['Maroquinerie', /leather ?goods|maroquinerie|leather ?craft/i],
  ['Patronage', /pattern ?making|patronage|mod[eé]lisme/i],
  ['Couture', /\bsewing\b|\bcouture\b/i],
  ['Textile', /\btextile/i],
  ['Stylisme', /(?<!hair )(?<!nail )\bstyling\b(?! (?:hair|tools))|stylisme/i],
  ['Photographie', /photograph/i],
  ['Montage vidéo', /video editing|montage vid[eé]o/i],
  ['Prise de parole', /public speaking|prise de parole/i],
  ['Management d’équipe', /team management|people management|management d'[eé]quipe|gestion d'[eé]quipe|team leadership/i],
  ['Leadership', /leadership/i],
  ['Vente', /\bsales\b|\bvente\b/i],
  ['Luxe', /\bluxury\b|\bluxe\b/i],
  ['Développement durable', /sustainability\b|sustainable (?:development|sourcing|fashion|materials?|packaging|supply|practices|strateg|initiative|program|design|products?|luxury|retail|solutions?)|d[eé]veloppement durable|\bRSE\b|\bCSR\b|\bESG\b/i],
  ['Traçabilité', /traceability|tra[cç]abilit[eé]/i],
  ['Circularité', /circular(ity)?\b|circularit[eé]/i],
  ['Intelligence artificielle', /artificial intelligence|intelligence artificielle|machine learning|generative ai|\bGenAI\b|\bLLMs?\b/i],
  ['Data science', /data scien/i],
  ['Cybersécurité', /cyber ?security|cybers[eé]curit[eé]/i],
  ['Cloud', /\bcloud\b(?! commerce)/i],
  ['ERP', /\bERP\b/],
  ['Point de vente (POS)', /\bPOS\b|point of sale|caisse\b/i],
  ['B2B', /\bB2B\b/],
  ['Marketplace', /marketplace/i],
  ['Franchise', /(?<!r[eé]seau de )(?<!network of )franchis(?:e|ing)\b(?! (?:leader|network|r[eé]seau))/i],
  ['Retail media', /retail media/i],
  ['Web3 / NFT', /\bweb ?3\b|\bNFTs?\b|metaverse|m[eé]tavers/i],
];

const CERTIFICATIONS: ReadonlyArray<[string, RegExp]> = [
  ['GIA', /\bGIA\b/],
  ['WSET', /\bWSET\b/],
  ['PMP', /\bPMP\b/],
  ['CFA', /\bCFA\b/],
  ['ACCA', /\bACCA\b/],
  ['Six Sigma Belt', /(green|black) belt/i],
  ['CIPD', /\bCIPD\b/],
  ['Permis B', /permis b\b|driving licen[cs]e|driver'?s licen[cs]e/i],
  ['CACES', /\bCACES\b/],
  ['HACCP', /\bHACCP\b/],
];

export const SKILL_DICTIONARY: ReadonlyArray<SkillDefinition> = [
  ...TOOLS.map(([name, pattern]) => ({ name, kind: 'tool' as const, pattern })),
  ...LANGUAGES.map(([name, pattern]) => ({ name, kind: 'language' as const, pattern })),
  ...CONCEPTS.map(([name, pattern]) => ({ name, kind: 'concept' as const, pattern })),
  ...CERTIFICATIONS.map(([name, pattern]) => ({ name, kind: 'certification' as const, pattern })),
];

const KIND_OF = new Map(SKILL_DICTIONARY.map((s) => [s.name, s.kind]));

export function skillKind(name: string): SkillKind | undefined {
  return KIND_OF.get(name);
}

const MAX_TEXT = 40_000;

/** Une langue compte si un mot de langue apparaît dans la fenêtre autour de la mention. */
function languageMentioned(text: string, pattern: RegExp): boolean {
  const re = new RegExp(pattern.source, pattern.flags.includes('g') ? pattern.flags : `${pattern.flags}g`);
  let match: RegExpExecArray | null;
  while ((match = re.exec(text)) !== null) {
    const start = Math.max(0, match.index - LANGUAGE_WINDOW);
    const end = Math.min(text.length, match.index + match[0].length + LANGUAGE_WINDOW);
    if (LANGUAGE_CUE_RE.test(text.slice(start, end))) return true;
  }
  return false;
}

/** Les compétences canoniques présentes dans un texte, triées, sans doublon. */
export function extractSkills(text: string | null | undefined): string[] {
  const body = (text ?? '').slice(0, MAX_TEXT);
  if (!body.trim()) return [];
  const found = new Set<string>();
  for (const skill of SKILL_DICTIONARY) {
    if (skill.kind === 'language') {
      if (languageMentioned(body, skill.pattern)) found.add(skill.name);
    } else if (skill.pattern.test(body)) {
      found.add(skill.name);
    }
  }
  return [...found].sort((a, b) => a.localeCompare(b, 'fr'));
}
