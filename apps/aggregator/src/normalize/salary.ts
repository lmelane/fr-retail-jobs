/**
 * SALAIRE lu dans le texte de l'annonce, quand le champ structuré est vide.
 *
 * Extrait de `normalize/contract.ts` le 2026-09-08, quand le contrat est devenu
 * `employmentType` : la lecture d'une fourchette de salaire n'a jamais eu de
 * rapport avec la nature de la relation d'emploi — les deux cohabitaient dans
 * le même fichier par accident d'histoire.
 */

/** Accents et casse retirés, comme partout dans les normaliseurs. */
function upper(raw: string): string {
  return raw
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase();
}

/**
 * A salary band, read from prose when the structured field is empty.
 *
 * Deliberately conservative: only euro amounts with an explicit currency mark
 * count ("2 000 €", "35K€", "30 000 - 35 000 EUR"), because bare numbers in a
 * posting are usually hours, headcounts or years. Amounts under 500 are
 * treated as hourly/daily noise and ignored rather than guessed at.
 */
/** Words that mark a euro amount as compensation rather than any other figure. */
const PAY_CONTEXT =
  /SALAIRE|SALARY|R[ÉE]MUN[ÉE]RATION|PACKAGE|\bBRUT\b|\bNET\b|COMPENSATION|K€|€\s?(?:BRUT|NET)|PAR\s?(?:AN|MOIS)|\/\s?(?:AN|MOIS|MONTH|YEAR)|ANNUEL|MENSUEL|PER\s?(?:YEAR|MONTH|ANNUM)/;

export function extractSalaryBand(
  description?: string | null,
): { min?: number; max?: number; period?: 'YEAR' | 'MONTH' } | null {
  if (!description) return null;
  const text = description.replace(/ /g, ' ');

  const upperText = upper(text);

  const toAmount = (raw: string): number => {
    const cleaned = raw.replace(/[\s.]/g, '').replace(',', '.');
    const value = Number(cleaned.replace(/K/i, ''));
    return /K/i.test(raw) ? value * 1000 : value;
  };

  // A pay word must appear within ~60 chars of the amount — a turnover or
  // budget figure elsewhere in the same posting must not qualify it.
  const hasPayContext = (index: number, length: number): boolean =>
    PAY_CONTEXT.test(upperText.slice(Math.max(0, index - 60), index + length + 60));

  const band = text.match(
    /(\d{1,3}(?:[\s.]\d{3})+|\d{2,3}\s?K)\s?(?:€|EUR)?\s?(?:-|à|et)\s?(\d{1,3}(?:[\s.]\d{3})+|\d{2,3}\s?K)\s?(?:€|EUR)/i,
  );
  if (band && band.index !== undefined && hasPayContext(band.index, band[0].length)) {
    const min = toAmount(band[1]);
    const max = toAmount(band[2]);
    if (min >= 500 && max >= min) {
      return { min, max, period: min < 10_000 ? 'MONTH' : 'YEAR' };
    }
  }

  const single = text.match(/(\d{1,3}(?:[\s.]\d{3})+|\d{2,3}\s?K)\s?(?:€|EUR)/i);
  if (single && single.index !== undefined && hasPayContext(single.index, single[0].length)) {
    const value = toAmount(single[1]);
    if (value >= 500) return { min: value, period: value < 10_000 ? 'MONTH' : 'YEAR' };
  }

  return null;
}
