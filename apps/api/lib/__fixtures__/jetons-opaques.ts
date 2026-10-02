/**
 * Les témoins différentiels (D-496, D-500) comparent un document au caractère près au document écrit par le code d'avant
 * leur lot, curseurs compris. Depuis la version 3 du curseur (lecture D-492 du 02/10/2026, curseur signé), un jeton est
 * chiffré sous un nonce aléatoire : deux jetons de la même clé ne sont jamais les mêmes octets, et un jeton de la version 2
 * n'est plus servi. On compare donc la PRÉSENCE du jeton (une suite existe ou non) ; ce qu'il désigne reste prouvé par la
 * page suivante, servie depuis ce jeton et comparée, elle, au caractère près.
 */
export function sansJetons(document: unknown): unknown {
  return JSON.parse(JSON.stringify(document, (cle, v) => (cle === 'suivant' && typeof v === 'string' ? '<jeton>' : v)));
}
