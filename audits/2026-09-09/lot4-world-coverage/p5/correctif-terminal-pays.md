# P5 — correctif terminal : cohérence pays / localisation

Mesures du 2026-09-11, **production en lecture seule**. Aucune écriture de production, crons gelés.
Borné à la cohérence pays / localisation du `JobPosting` — aucun autre contrôle P5 n'est rouvert.

## Avant

Le cas cité, vérifié en base : **`« San Francisco, CA; Seattle, WA; or San Diego, CA »` portait
`countryCode = CA`**, et le générateur appliquait ce pays unique à tous les segments. Dans un `JobPosting`,
`addressCountry: 'CA'` désigne **le Canada** : des villes américaines étaient donc publiées au Canada.

Trois autres défauts de la même famille :

| Défaut | Constat |
|---|---|
| Le `countryCode` global appliqué aveuglément | tous les segments d'une multilocalisation recevaient le même pays, sans vérifier qu'il leur correspond |
| `NO_USABLE_LOCATION` acceptait `city` **OU** `countryCode` | une ville sans pays suffisait à déclarer la localisation conforme, alors qu'`addressCountry` est requis |
| Une offre REMOTE devenait éligible par sa **ville** | `applicantLocationRequirements` doit dire depuis **où** l'on peut candidater ; une ville ne le dit pas |

## Cause

Le générateur et la porte exprimaient la localisation **à deux endroits**, et aucun ne vérifiait la cohérence du
pays. Un `countryCode` était pris pour un pays sans jamais être confronté au libellé.

## Modifications

`resolveLocation()` remplace `physicalPlaces()` et `locationProperties()`, et rend **soit des lieux au pays
établi, soit un refus nommé**. La porte d'éligibilité et le générateur appellent **cette même fonction** : ils ne
peuvent plus divergir — c'est une divergence de ce type qui avait laissé passer le cas `CA`.

**Quatre motifs d'inéligibilité ajoutés :**

| Motif | Règle imposée |
|---|---|
| `PHYSICAL_LOCATION_WITHOUT_COUNTRY` | un `jobLocation` physique n'est publiable **que si** son `addressCountry` est établi. Une ville seule ne suffit pas, et le pays ne se devine pas depuis elle |
| `REMOTE_WITHOUT_ELIGIBILITY_COUNTRY` | un poste totalement distant exige **au moins un pays d'éligibilité réellement connu** |
| `LOCATION_COUNTRY_CONFLICT` | le libellé contredit le pays canonique |
| `MULTI_LOCATION_COUNTRY_NOT_PROVEN` | pays commun non démontré, ou lieux couvrant plusieurs pays |

**Les segments ambigus ne deviennent jamais une `addressLocality`** : `"or San Diego, CA"` (conjonction laissée
par l'énumération), `"Scotland"`, `"United States"` (territoires entiers).

Quand la donnée ne permet pas une localisation structurée fiable, **la page reste visible et aucun `JobPosting`
n'est émis**. Rien n'est deviné, rien n'est complété.

## Le faux positif trouvé en mesurant, et corrigé

Ma première règle signalait **tout** suffixe collisionnant dès que `countryCode ≠ US` : **1 792 conflits**, dont
**665 « …, DE » sous le pays `DE` »** — des libellés parfaitement cohérents (`DE` y désigne l'Allemagne) dont
j'aurais supprimé le balisage à tort.

Un conflit n'existe que si le suffixe n'est **ni** le pays déclaré **ni** une subdivision **de** ce pays :
« Seattle, WA » sous `US` reste valide, le même libellé sous `DE` non. **Conflits : 1 792 → 142.**

*Cas honnête déclaré : « Indianapolis, IN » sous le pays `IN` (Inde) est accepté, parce qu'aucune contradiction
n'y est DÉMONTRABLE — le suffixe redit le pays. Trancher demanderait une table ville → pays que nous n'avons pas
(D54, déjà acté pour les 43 offres `AZ`/`AR`/`NH`).*

## Tests bornés — les cinq exigés, plus trois

| # | Scénario | Résultat |
|---|---|---|
| **1** | « San Francisco, CA; Seattle, WA; or San Diego, CA » sous `CA` | `LOCATION_COUNTRY_CONFLICT`, **aucun balisage**, et `"CA"` absent du JSON |
| **2** | « New York, N.Y.; Washington, D.C. » sans `countryCode` | `MULTI_LOCATION_COUNTRY_NOT_PROVEN`, **aucun balisage** |
| **3** | REMOTE avec ville mais sans pays | `REMOTE_WITHOUT_ELIGIBILITY_COUNTRY`, **aucun balisage** |
| **4** | REMOTE avec pays réel | `TELECOMMUTE` + `{Country, US}` |
| **5** | multilocalisation au pays commun établi | **3** `jobLocation`, chacun avec `addressCountry: US` |
| + | segment non publiable comme localité | refusé sur les 3 libellés testés |
| + | suffixe qui **redit** le pays (« Berlin, DE » sous `DE`) | **accepté** |
| + | ville sans pays (non distante) | `PHYSICAL_LOCATION_WITHOUT_COUNTRY` |

**122 tests web verts**, typecheck 0 erreur sur les deux workspaces.

## Après — vérifié sur les pages SERVIES

| | |
|---|---|
| Fiches conformes | **33 / 33**, 0 échec |
| Balisage émis sur l'échantillon | 15 → **12** |
| Le cas `CA` cité (`cmtlyjc30081zqf5k3s3l7q4m`) | page **200**, `JobPosting` **0**, `addressCountry:"CA"` **0** |
| Multilocalisation échantillonnée | **aucun balisage** (pays non prouvé) |
| Télétravail échantillonné | `TELECOMMUTE` + `{Country, US}`, aucune localité inventée |

### Mesures de localisation, par identifiants

| Mesure | Offres |
|---|---:|
| physique avec ville **sans pays** | **3 937** |
| **conflit** segment / `countryCode` | **142** |
| multilocalisée à laquelle **un seul pays** est appliqué | **45** |
| REMOTE **sans pays d'éligibilité** | **23** |

Identifiants dans `public-pages.json` (`locationMeasures`, 10 par mesure).

### Nouveaux dénominateurs

| Mesure | Offres |
|---|---:|
| `visibleOnModeCareers` | **78 932** |
| `googleEligible` | **71 961** |
| `googleIneligible` | **6 971** |

Par motif : `PHYSICAL_LOCATION_WITHOUT_COUNTRY` 3 937 · `NO_REAL_POSTED_DATE` 1 450 · `NO_USABLE_LOCATION` 779 ·
`DESCRIPTION_TOO_THIN` 477 · `VALID_THROUGH_EXPIRED` 257 · `LOCATION_COUNTRY_CONFLICT` 142 ·
`REMOTE_WITHOUT_ELIGIBILITY_COUNTRY` 23 · `MULTI_LOCATION_COUNTRY_NOT_PROVEN` 11 · `OPEN_APPLICATION` 1.

*(La somme dépasse 6 971 : certaines offres cumulent plusieurs motifs. Les motifs sont comptés par condition,
chaque offre étant nommée dans le fichier.)*

## Terminologie corrigée

- **le seuil de 100 caractères est une règle conservatrice interne de Mode Careers**, pas un seuil numérique
  fourni par Google — écrit dans le code (`MIN_DESCRIPTION_LENGTH`) et dans la sortie
  (`descriptionThresholdOrigin`) ;
- **`googleEligible` signifie « conforme à la porte technique actuelle de Mode Careers »**, et rien de plus :
  ni une garantie d'apparition dans Google Jobs, ni une promesse d'acceptation. Porté par le champ
  `googleEligibleMeaning` de la sortie, et affiché à chaque exécution ;
- **`googlePresence` reste non mesurée**, et ne se déduit pas du balisage.

## Restant, déclaré

| Point | État |
|---|---|
| **3 937 offres physiques sans pays** | inéligibles, **visibles**. Remplir le pays est un sujet de donnée géographique (le normaliseur `resolveGeography` existe côté ingestion), hors périmètre de ce correctif |
| **142 conflits** | inéligibles, visibles. Chaque identifiant est nommé ; la résolution demande soit une preuve de pays par segment, soit une table ville → pays que nous n'avons pas |
| « Indianapolis, IN » sous `IN` | accepté faute de contradiction démontrable — cohérent avec D54 |
