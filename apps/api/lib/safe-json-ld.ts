/**
 * Échappement d'un JSON-LD destiné à un `<script type="application/ld+json">`.
 *
 * Les valeurs viennent de flux ATS tiers : un titre ou une description contenant `</script>` refermerait le bloc
 * et injecterait du balisage dans la page (XSS stocké). Les échappements sont écrits en `\u` pour que ce fichier
 * reste en ASCII.
 *
 * Vit dans `lib/` et non dans la page : un fichier de route Next.js ne peut exporter que ses entrées réservées,
 * et l'y exporter pour le tester cassait la compilation (`OmitWithTag … does not satisfy the constraint`).
 */
export function safeJsonLd(data: unknown): string {
  // Construit depuis une chaîne pour que ce source ne porte aucun U+2028/U+2029 littéral (ce sont des
  // terminateurs de ligne : ils casseraient le fichier lui-même).
  const dangerous = new RegExp('[<\\u2028\\u2029]', 'g');
  return JSON.stringify(data).replace(
    dangerous,
    (ch) => '\\u' + ch.charCodeAt(0).toString(16).padStart(4, '0'),
  );
}
