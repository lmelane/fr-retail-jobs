import { LANGUES_LIBELLES, langueDesLibelles } from '@catwalks/db/presentation';
import { localeServie, type Perimetre, type CleFacette } from '@catwalks/db/marches';

/** La locale présente les mêmes résultats. Elle ne participe jamais au plan SQL ni au curseur. */
export function localeAffichage(demande: string | undefined, perimetre?: Perimetre): string {
  if (perimetre?.marche) {
    const m = perimetre.marche;
    const candidate = demande?.trim().toLowerCase();
    const locale = m.locales.find((l) => l.toLowerCase() === candidate
      || (candidate && !candidate.includes('-') && l.split('-')[0].toLowerCase() === candidate));
    return locale && (LANGUES_LIBELLES as readonly string[]).includes(locale.slice(0, 2).toLowerCase())
      ? locale : localeServie(m)!;
  }
  if (demande && /^[a-z]{2}(?:-[a-z]{2})?$/i.test(demande)
    && (LANGUES_LIBELLES as readonly string[]).includes(demande.slice(0, 2).toLowerCase())) return demande;
  return 'fr-FR';
}

const CLES: CleFacette[] = ['pays', 'metier', 'secteur', 'contrat', 'temps', 'programme', 'ville', 'maison', 'groupe', 'langue'];
const NOMS = {
  fr: ['Pays', 'Métier', 'Secteur', 'Type de contrat', 'Temps de travail', 'Programme', 'Ville', 'Maison', 'Groupe', 'Langue'],
  en: ['Country', 'Job category', 'Sector', 'Contract type', 'Working hours', 'Programme', 'City', 'Maison', 'Group', 'Language'],
  de: ['Land', 'Beruf', 'Branche', 'Vertragsart', 'Arbeitszeit', 'Programm', 'Stadt', 'Maison', 'Gruppe', 'Sprache'],
  it: ['Paese', 'Professione', 'Settore', 'Tipo di contratto', 'Orario di lavoro', 'Programma', 'Città', 'Maison', 'Gruppo', 'Lingua'],
  nl: ['Land', 'Functie', 'Sector', 'Contracttype', 'Werktijd', 'Programma', 'Stad', 'Maison', 'Groep', 'Taal'],
  es: ['País', 'Profesión', 'Sector', 'Tipo de contrato', 'Jornada laboral', 'Programa', 'Ciudad', 'Maison', 'Grupo', 'Idioma'],
  zh: ['国家', '职位类别', '行业', '合同类型', '工作时间', '项目', '城市', '品牌', '集团', '语言'],
};

export function nomFacette(cle: CleFacette, natif: string, perimetre: Perimetre, locale: string): string {
  const langue = langueDesLibelles(locale);
  // Le registre canadien a été relevé en français ; son défaut de service est anglais.
  if (perimetre.code === 'CA' && ['contrat', 'temps'].includes(cle)) return langue === 'fr' ? 'Type de poste' : langue === 'en' ? 'Job type' : NOMS[langue][CLES.indexOf(cle)];
  if (perimetre.code === 'CA' && langue === 'fr') return natif;
  if (perimetre.code === 'BE' && langue === 'fr') return natif.split(' · ')[0];
  if (perimetre.code !== 'CA' && langue === langueDesLibelles(localeServie(perimetre.marche))) return natif;
  return NOMS[langue][CLES.indexOf(cle)];
}
