# D62 — Identité du crawler, robots.txt et portée des collectes publiques

> **Décision propriétaire définitive du 2026-09-13.** S'applique à Catwalks et à tous ses produits, y compris
> l'agrégateur connu sous « Mode Careers », à migrer sous l'écosystème `catwalks.io`. Ne se redemande plus
> Maison par Maison ni ATS par ATS lorsque les conditions sont identiques.

## Ce qui a déclenché la décision

La vague 1 de P9 a lu à la source le `robots.txt` de `api.smartrecruiters.com` :

```
User-agent: LinkedInBot
Allow: /v1/companies/
User-agent: *
Disallow: /
```

HTTP 200, 72 octets, sha256 `834faf99999604ea…`. **46 sources ACTIVE du catalogue passent par cet hôte et
portent 5 155 offres actives.** Le catalogue les avait enregistrées `ALLOWED` début septembre.

## L'identité du crawler

**`CatwalksBot/1.0 (+https://catwalks.io/bot)`** — sur TOUS les modes de collecte : API, JSON, XML, RSS,
sitemap, HTML, navigateur automatisé, rendu JavaScript.

**Jamais** : `ModeCareersBot`, `modecareers.com/bot`, `LinkedInBot`, `Googlebot`, `IndeedBot`, ni le nom d'un
autre opérateur.

**Préalable bloquant à l'activation** : `https://catwalks.io/bot` doit répondre **HTTP 200** et indiquer
l'opérateur, l'objet de la collecte, le périmètre sectoriel, une adresse réellement surveillée et une
procédure de signalement. *Ne pas activer un User-Agent dont l'URL rend 404.*

## La portée de l'autorisation

Le propriétaire déclare disposer des autorisations pour collecter, agréger, indexer et rediffuser les offres
**publiquement diffusées** du périmètre : luxe, mode, beauté, retail, horlogerie, joaillerie, parfumerie,
cosmétique, accessoires et secteurs connexes retenus au catalogue.

**Le support technique ne change pas la portée.** Sont couverts : page carrière publique, portail sur le
domaine de la Maison, portail hébergé par un ATS, **API publique de publication de l'ATS**, endpoint JSON
public du portail, XML/RSS, sitemap, portail régional, portail de groupe, page HTML sans ATS, site
propriétaire, page nécessitant un rendu JavaScript normal.

## Pas de liste « ATS autorisé / ATS interdit »

La décision ne se prend **jamais** sur le nom commercial de l'ATS. Un même éditeur expose des surfaces
publiques *et* des surfaces privées : elles ne relèvent pas du même régime. La décision se prend sur **la
surface réellement interrogée**.

## robots.txt : le fait observé est conservé, il ne décide plus seul

Un `Disallow: /` s'enregistre **honnêtement** — jamais transformé en `ALLOWED`. Ce qui change, c'est qu'il
n'est plus la décision à lui seul. Champs à porter par cible :

```
robotsObserved · robotsCheckedAt · robotsEvidenceSha256 · robotsUserAgentEvaluated
authorizationBasis · accessSurface · effectiveAccessDecision
crawlerIdentity · ownerDecisionAt · ownerDecisionScope
```

La vérité complète pour SmartRecruiters devient :

```
robotsObserved          = DISALLOWED
authorizationBasis      = OWNER_SECTOR_AUTHORIZATION
accessSurface           = PUBLIC_ATS_JOB_API
effectiveAccessDecision = ALLOWED
crawlerIdentity         = CatwalksBot/1.0
```

Un `Disallow` observé ne provoque plus automatiquement : mise en PAUSED, retrait ou fermeture d'offres,
abandon d'une source, ni nouvel arbitrage propriétaire.

## Ne JAMAIS usurper LinkedInBot

L'exception `User-agent: LinkedInBot / Allow: /v1/companies/` signifie seulement que SmartRecruiters a nommé
LinkedInBot. **Elle ne nous concerne pas.** Interdits : déclarer ce User-Agent, imiter sa signature,
reproduire ses en-têtes, ou inscrire dans une preuve que l'exception nous a été accordée. Notre droit d'accès
repose sur notre autorisation et sur la nature publique des offres, **jamais sur l'identité d'un tiers**.

## Le scraping HTML reste un mode NORMAL

Une règle « API obligatoire, HTML interdit » serait fausse et ferait perdre des Maisons. Ordre de préférence :
API ou flux structuré public s'il existe et restitue le périmètre → endpoints publics du portail → **scraping
HTML du portail officiel** quand aucune API n'existe, qu'elle est incomplète, que les détails ne sont que dans
la fiche, ou que le site est propriétaire → navigateur automatisé si un rendu JavaScript normal est requis.

*Ne pas réécrire un collecteur HTML fonctionnel pour le remplacer artificiellement par une API.*

## Cas SmartRecruiters — décision appliquée

Les **46 sources restent ACTIVE**, les **5 155 offres actives sont conservées**, la collecte de l'API publique
continue. Pas de PAUSED, pas de fermeture sur la seule base de robots, pas de 46 scrapers HTML créés pour
éviter l'API. `CatwalksBot/1.0`, jamais LinkedInBot. La décision couvre l'API **publique des offres**, pas les
autres produits privés de l'éditeur.

## Ce qui reste HORS périmètre

`accessSurface = PRIVATE_OR_INTERNAL` · `effectiveAccessDecision = NOT_AUTHORIZED` pour : comptes candidats,
CV, lettres, profils, candidatures, notes RH, données personnelles non publiées, viviers privés, offres
internes, back-office, administration de tenant, configuration et statistiques privées, données exigeant des
identifiants non attribués, endpoints atteints en contournant un contrôle d'accès, session privée d'un tiers.

Interdits en toute circonstance : voler ou réutiliser les identifiants d'un tiers, casser une
authentification, usurper un partenaire, exploiter une fuite. **Si un accès public devient privé, on arrête
cette surface et on documente le changement.**

## La politesse réseau n'est pas levée

Les décisions de P8 tiennent : concurrence 4, budget par tenant, `rateLimitKey` par tenant réel, `Retry-After`
respecté, cooldown partagé, backoff borné, jitter, aucune recherche du point de rupture, arrêt au premier 429
quand la garde est armée, aucune double écriture, aucune perte d'identifiant.

**Un 429 dit de ralentir. Il ne dit pas que la collecte publique est interdite.**

## Valeurs de `accessSurface`

`PUBLIC_OFFICIAL_API` · `PUBLIC_ATS_JOB_API` · `PUBLIC_PORTAL_JSON` · `PUBLIC_XML_OR_RSS` ·
`PUBLIC_SITEMAP` · `PUBLIC_OFFICIAL_HTML` · `PUBLIC_ATS_HTML` · `PUBLIC_JS_RENDERED_PAGE` ·
`PRIVATE_OR_INTERNAL`

## Ce qu'on ne remonte PLUS au propriétaire

Un `Disallow` robots sur une surface publique d'offres · une API sur le domaine de l'ATS · une Maison sans
ATS · une collecte qui exige du HTML ou du JavaScript · un éditeur qui n'a pas nommé Catwalks · un éditeur qui
a nommé un autre crawler · un endpoint public non documenté.

**Ce qu'on remonte** : endpoint candidat ou RH privé · authentification privée obligatoire · données
personnelles non publiques · offre interne · contrôle d'accès à contourner · demande explicite d'un
propriétaire ou d'un éditeur · contradiction avec un contrat Catwalks · doute sérieux sur l'identité du
tenant · contenu manifestement hors secteur · portail tiers suspect · **un accès public qui devient privé**.

## Règles inchangées

FashionJobs reste un outil de **découverte d'acteurs**, jamais une source d'offres. WTTJ reste utilisable dans
le cadre déjà décidé. Aucune source exclue n'est réintroduite par effet de cette clarification.
