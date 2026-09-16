# Observation des règles d’accès

État relu le **16 septembre 2026**, lot 5G3B1. Ce document décrit le lecteur maintenu ; il ne vaut pas certification d’accès de toutes les sources.

## Trois objets distincts

Le corps natif de `robots.txt`, l’observation calculée pour une requête et la décision d’accès sont distincts. Une autorisation déjà obtenue ne réécrit pas le document observé. La [RFC 9309](https://www.rfc-editor.org/rfc/rfc9309.html#section-1) distingue elle-même ces règles d’une autorisation d’accès.

Les captures `SOURCE_ACCESS` gardent les réponses et redirections dans le journal natif ; leur lecture vérifie le manifeste et chaque empreinte, y compris depuis l’archive froide. Le [parcours de source](source-onboarding.md) les produit sans activer de source ni publier d’offre.

## Identité et règles

[crawlerIdentity.ts](../../apps/aggregator/src/lib/crawlerIdentity.ts) définit `CatwalksBot`, utilisé dans l’en-tête HTTP et dans le [lecteur de règles](../../apps/aggregator/src/lib/robotsVerdict.ts). L’identité HTTP reste `CatwalksBot/1.0 (+https://catwalks.io/bot)`.

Les groupes nommant exactement ce produit sont combinés sans distinction de casse. À défaut, les groupes `*` sont combinés. Les règles propres à un autre robot ne sont pas empruntées. Les enregistrements inconnus ne séparent pas les groupes ; la comparaison des chemins garde la casse, la requête, les octets UTF-8 et les échappements réservés. La règle la plus spécifique prévaut, avec Allow en cas d’égalité. Références : [RFC 9309, règles](https://www.rfc-editor.org/rfc/rfc9309.html#section-2.2), [exemples de comparaison de Google](https://developers.google.com/crawling/docs/robots-txt/robots-txt-spec#order-of-precedence-for-rules).

Le lecteur traite les jokers et ancres sans construire de regex depuis les données. Il accepte au moins 500 Kio de texte, borne le chemin à 16 Kio et partage un plafond de cinq millions d’étapes entre toutes les comparaisons. Une limite dépassée interrompt l’évaluation ; une lecture partielle ne rend pas `ALLOWED`.

Les chemins doivent être fournis sous la forme `pathname + query`, sans origine ni fragment. Le lecteur ne choisit pas les requêtes d’un adaptateur à sa place. Les tokens d’agent mal formés sont ignorés ; les variantes non standard contenant un numéro de version ne font pas partie du contrat qualifié.

## Observation HTTP

[robotsReading](../../apps/aggregator/src/lib/candidateChecks.ts) restitue une observation technique :

| Entrée | Observation |
|---|---|
| Réponse 2xx interprétable | `ALLOWED` ou `DISALLOWED` pour le chemin fourni |
| Réponse 404 ou 410 | `NO_ROBOTS` |
| Autre réponse non réussie ou erreur réseau | `UNREACHABLE` |
| Limite ou erreur de comparaison | `UNREACHABLE`, `ROBOTS_RULES_NOT_EVALUATED`, avec statut, taille et hash du corps reçu |

La politique locale est plus restrictive que la possibilité d’accès laissée par la RFC pour certaines autres réponses 4xx. Elle ne transforme pas une erreur en lecture favorable. Un hash identifie un contenu ; il ne date pas la lecture et ne prouve pas une autorisation.

La disponibilité de la page publique du robot doit être mesurée séparément. La fonction inutilisée qui prétendait la vérifier a été retirée, ainsi que les commentaires contradictoires 404/200 et le renvoi à une page supprimée de `apps/web`. Les tests de constantes n’affirment plus mesurer sa disponibilité.

## Limites avant release

- `Source.robotsVerdict` et `robotsCheckedAt` restent des champs historiques mutables utilisés par la promotion. Ils doivent être remplacés par une décision immuable et liée à la révision.
- Le fingerprint actuel des requêtes ne conserve pas le `User-Agent` ; le journal garde une URL expurgée des valeurs de paramètres. La preuve d’accès devra conserver une provenance native suffisante, sans inventer rétrospectivement ces valeurs pour les anciennes captures.
- `requestTarget()` reste un diagnostic partiel d’une première cible supposée. Les preuves devront couvrir les requêtes réellement capturées, leurs méthodes, origines, chemins, paramètres, redirections et identité de collecteur.
- `readRobots()` reste un diagnostic HTTP simple. Il ne suffit pas à qualifier le MIME, une page de challenge, la fraîcheur, toutes les redirections et toute la portée d’une source. Le futur évaluateur de capture devra contrôler ces propriétés avant toute décision.
- Les règles existantes d’autorisation sectorielle et les autorisations déjà obtenues restent distinctes de l’observation. Ce lot ne crée ni ne révoque aucune autorisation.
- La décision complète devra être revérifiée à l’ingestion, y compris pour les sources déjà actives. Le présent lecteur ne constitue pas cette porte de publication.

Le [bilan du lot](../../audits/reprise-2026-09-15/lot-5g3b1.md) contient les contrôles, contre-épreuves et preuves natives. Les commandes courantes restent dans le document d’onboarding.
