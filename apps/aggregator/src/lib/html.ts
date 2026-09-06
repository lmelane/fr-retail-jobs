/**
 * Turn a source's description into clean, plain text — at INGEST, once, for
 * every source.
 *
 * Coverage across ATS is uneven: some ship plain text, some raw HTML
 * (Greenhouse's `content`), some HTML-escaped HTML (Teamtailor's JSON-LD). Doing
 * this at write time means the database only ever holds clean text and the web
 * never has to repair a row at display time.
 *
 * Order matters: DECODE ENTITIES FIRST, THEN STRIP TAGS. Teamtailor's JSON-LD is
 * escaped ("&lt;p&gt;…"); stripping first finds no tags, and the later decode
 * recreates them as literal markup on screen (base64 emoji images included).
 * Decoding first turns the markup into real tags in time for the tag pass.
 */
export function htmlToPlainText(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  // Greenhouse échappe deux fois (« &amp;amp; » sur 2 515 offres, audit A1) : un
  // premier passage rend « &amp; », le décodage normal fait le reste.
  const text = value
    .replace(/&amp;(amp|lt|gt|nbsp|quot|#\d+|#x[0-9a-f]+);/gi, '&$1;')
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(Number(dec)))
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
    .replace(/&(?:quot|rsquo|lsquo|apos);/g, "'")
    .replace(/&hellip;/g, '…')
    .replace(/&(?:mdash|ndash);/g, '–')
    /**
     * Un TITRE de section s'isole des deux côtés.
     *
     * Seules les balises FERMANTES produisaient un saut : « <h2>Vue
     * d'Ensemble</h2><p>Vous vous… » donnait « Vue d'Ensemble Vous vous… », le
     * titre collé à son paragraphe. Mesuré en prod le 2026-09-05 : 7 021 offres
     * actives étaient un bloc de plus de 400 caractères SANS un seul saut de
     * ligne — les « gros pâtés » signalés par Loïc. La structure existait
     * pourtant dans la source ; elle était aplatie ici.
     *
     * On ouvre donc par une ligne vide avant le titre, et on ferme par une
     * ligne vide après : le lecteur voit des sections, pas un mur.
     */
    .replace(/<h[1-6][^>]*>/gi, '\n\n')
    .replace(/<\/h[1-6]>/gi, '\n\n')
    // Un paragraphe ou un bloc s'ouvre aussi sur sa propre ligne : sans ça,
    // « </p><p> » ne rendait qu'un seul saut et deux paragraphes se
    // confondaient en un seul pavé.
    .replace(/<(p|div)[^>]*>/gi, '\n')
    // List items become bullet lines; block ends become newlines.
    .replace(/<li[^>]*>/gi, '\n• ')
    .replace(/<\/(p|div|li|ul|ol)>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]*>/g, ' ')
    // Inline bullets from sources that never used <li>: give each its own line.
    .replace(/\s+•\s*/g, '\n• ')
    // Non-breaking spaces (from &nbsp; / &#xa0;) collapse to a normal space.
    .replace(new RegExp('[\\u00a0\\u202f]', 'g'), ' ')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return text || undefined;
}
