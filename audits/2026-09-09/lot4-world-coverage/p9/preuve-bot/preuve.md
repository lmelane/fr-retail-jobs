# Preuve — `https://catwalks.io/bot` est servi (préalable D62)

Relevé le **2026-09-14** depuis l'extérieur, sans authentification.

| | |
|---|---|
| URL | `https://catwalks.io/bot` |
| Statut HTTP | **200** |
| URL finale | `https://catwalks.io/bot` (aucune redirection sortante) |
| Type | `text/html; charset=utf-8` |
| Taille | 35920 octets |
| sha256 de la page archivée | `bc33fe34b39bd152ec5d5c46aa49fca2bd1c9d09d6bf6450ac3a36fb94cfae5e` |
| Page archivée | `catwalks-io-bot-20260914.html` |
| Dépôt qui la sert | `lmelane/catwalks-front-end`, commit `d17959a` |

## Les contrôles exigés, et leur résultat

| Contrôle | Résultat |
|---|---|
| HTTP 200 depuis l'extérieur | **oui** |
| Accessible sans authentification | **oui** — aucune redirection vers une page de connexion |
| Ne dépend pas exclusivement de JavaScript | **oui** — page `○ (Static)` prérendue ; tout le contenu reste lisible scripts retirés |
| Contient l'User-Agent EXACT | **oui** — `CatwalksBot/1.0 (+https://catwalks.io/bot)` |
| Ne contient PAS l'ancienne URL | **oui** — 0 occurrence de `modecareers.com/bot` |
| Identifie Catwalks comme opérateur | **oui** — `CATWALKS`, avec lien vers les mentions légales |
| Explique le périmètre public collecté | **oui** — offres publiques du secteur, et ce qui n'est jamais collecté |
| Indique le comportement du robot | **oui** — rythme limité, `Retry-After`, `429`, préférence pour les flux publics |
| Contact réellement surveillé | **oui** — `contact@catwalks.io`, le support du site, pas une boîte dédiée inerte |
| Procédure de retrait et de signalement | **oui** — courriel, et exclusion par `robots.txt` |
| `botInfoUrlIsServed()` | **true**, code de sortie 0 |

## En-têtes relevés

```
HTTP/2 200 
accept-ranges: bytes
access-control-allow-origin: *
age: 33
cache-control: public, max-age=0, must-revalidate
content-disposition: inline
content-security-policy: default-src 'self'; script-src 'self' 'unsafe-inline' https://maps.googleapis.com https://maps.gstatic.com https://us-assets.i.posthog.com https://analytics.ahrefs.com https://challenges.cloudflare.com; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; img-src 'self' data: blob: https://storage.googleapis.com https://images.unsplash.com https://catwalksmedia.com https://maps.googleapis.com https://maps.gstatic.com https://*.ggpht.com https://*.googleapis.com https://purecatamphetamine.github.io; font-src 'self' data: https://fonts.gstatic.com; connect-src 'self' https://catwalks.api.catwalks.io https://maps.googleapis.com https://maps.gstatic.com https://places.googleapis.com https://us-assets.i.posthog.com https://us.i.posthog.com https://analytics.ahrefs.com; frame-src https://www.google.com https://www.youtube-nocookie.com https://challenges.cloudflare.com; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'
content-type: text/html; charset=utf-8
date: Mon, 14 Sep 2026 07:49:10 GMT
etag: "afc78bf318a4b8406bb5a718f5414dab"
permissions-policy: camera=(), microphone=(), geolocation=()
referrer-policy: strict-origin-when-cross-origin
server: Vercel
strict-transport-security: max-age=63072000; includeSubDomains
vary: rsc, next-router-state-tree, next-router-prefetch, next-router-segment-prefetch
x-content-type-options: nosniff
x-frame-options: DENY
x-matched-path: /bot
x-nextjs-prerender: 1
x-nextjs-stale-time: 300
x-vercel-cache: HIT
x-vercel-id: cdg1::n6wx8-1789372149947-76b8928df5f2
content-length: 35920
```

*Le préalable bloquant de D62 est levé : l'identité annoncée par le collecteur mène désormais à une page qui
nomme l'opérateur et ouvre une voie de retrait.*
