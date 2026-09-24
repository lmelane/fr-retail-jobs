import { LANGUES_LIBELLES, langueDesLibelles, FACET_LABELS as noms } from '@catwalks/db/presentation';
import { localeServie, type Perimetre, type CleFacette } from '@catwalks/db/marches';

/** La locale présente les mêmes résultats et ne modifie ni le plan SQL ni le curseur. */
export function localeAffichage(demande: string | undefined, perimetre?: Perimetre): string {
  const candidate = demande?.trim().toLowerCase();
  if (perimetre?.marche) {
    const m = perimetre.marche;
    const locale = m.locales.find((l) => l.toLowerCase() === candidate
      || (candidate && langueDesLibelles(l) === langueDesLibelles(candidate)
        && (LANGUES_LIBELLES as readonly string[]).includes(candidate === 'zh-cn' ? 'zh' : candidate === 'zh-hant' ? 'zh-Hant' : candidate === 'pt-br' ? 'pt-BR' : candidate)));
    return locale ?? localeServie(m)!;
  }
  if (demande) {
    try {
      const l = new Intl.Locale(demande);
      if ((LANGUES_LIBELLES as readonly string[]).includes(l.language)) return l.toString();
    } catch { /* paramètre invalide */ }
  }
  return 'fr-FR';
}

export function nomFacette(cle: CleFacette, _natif: string, perimetre: Perimetre, locale: string): string {
  const langue = langueDesLibelles(locale);
  if (perimetre.code === 'CA' && langue === 'fr' && cle === 'contrat') return "Type d’emploi";
  return noms[langue][cle];
}
