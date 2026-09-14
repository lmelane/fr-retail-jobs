/**
 * `URLSearchParams` → objet qui GARDE les valeurs répétées (D-426).
 *
 * À utiliser partout où l'on écrivait `Object.fromEntries(searchParams)`.
 * Cette forme-là ne conserve qu'une valeur par clé : `?pays=FR&pays=US` y
 * devient `{pays: 'US'}`, et tout le multi-valeurs des parseurs est annulé
 * AVANT même de les atteindre.
 *
 * Mesuré en production le 14/09/2026, puis reproduit après un premier
 * correctif incomplet : rendre `parseFilters` multi-valeurs ne suffisait pas,
 * l'annuaire continuait de rendre 297 Maisons sur `FR+US` (US seul) au lieu
 * de 640. Les deux moitiés du chemin doivent être corrigées, et c'est
 * précisément ce qui rendait le défaut difficile à voir : chacune, lue seule,
 * paraissait correcte.
 */
export function paramsMultiples(sp: URLSearchParams): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const cle of new Set(sp.keys())) out[cle] = sp.getAll(cle);
  return out;
}
