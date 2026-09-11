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

---

# Addendum — preuve INDÉPENDANTE du pays pour les codes ambigus (2026-09-11)

## Le défaut restant : une validation circulaire

La règle précédente considérait `suffix === countryCode` comme « pas de conflit ». **C'est circulaire** quand le
`countryCode` a lui-même été déduit de ce suffixe : « El Segundo, CA » sous le pays `CA` se confirmait tout seul.

**Mesuré** : **1 936 offres** ont un suffixe ambigu égal à leur code pays, et **aucune** ne porte de nom de pays
écrit en toutes lettres dans son `raw`. Vérifié sur échantillon — ces lignes n'ont **aucune clé pays** dans leur
payload : le `countryCode` vient bien du seul suffixe.

## La règle imposée

Un code **ambigu** (à la fois code pays ISO et subdivision US/CA) exige une preuve **indépendante du suffixe** :

| Preuve acceptée | Pourquoi elle est indépendante |
|---|---|
| `countryIntegrity` renseignée et non douteuse | c'est le jugement de la chaîne d'ingestion, construit en D54 pour exactement cette question |
| Le libellé **nomme le pays en toutes lettres** | « Germany », « United States » ne sont pas le suffixe à deux lettres |
| Un **code postal** | le suffixe ne le produit pas |
| Le pays n'est **pas ambigu** (`FR`, `IT`, `GB`…) | il n'est subdivision de rien : la question ne se pose pas |

**Ne valent PAS preuve** : le suffixe lui-même, ni le fait qu'un `countryCode` existe en base.

Sans preuve : **page visible, aucun `JobPosting`**, motif `AMBIGUOUS_COUNTRY_WITHOUT_INDEPENDENT_PROOF`.
Aucune ville ni pays inventé. **Aucune table mondiale des villes construite** — la règle réutilise la
connaissance `COLLIDING_CODES` déjà portée par le normaliseur d'ingestion.

> `countryIntegrity` est **vide en production** (0 valeur sur 78 932). La règle la lit malgré tout : dès qu'une
> ingestion la renseignera, le verdict suivra **sans nouveau correctif**. La remplir serait une écriture de
> production, hors périmètre P5.

## Le test « Indianapolis, IN » est RETIRÉ comme comportement conforme

Conformément à l'arbitrage : `IN` peut désigner l'Indiana, et la coïncidence entre suffixe et pays n'est pas une
preuve que le pays est l'Inde.

## Tests terminaux — les six exigés, plus quatre gardes

| # | Cas | Résultat |
|---|---|---|
| **A** | « El Segundo, CA » sous `CA`, sans preuve | `AMBIGUOUS_COUNTRY_WITHOUT_INDEPENDENT_PROOF`, **aucun balisage** |
| **B** | « Indianapolis, IN » sous `IN`, sans preuve | idem |
| **C** | « Berlin, Germany » sous `DE` | **balisage autorisé**, `addressCountry: DE` |
| **D** | « Seattle, WA, United States » sous `US` | **balisage autorisé**, `addressCountry: US` |
| **E** | multilocalisation US prouvée indépendamment | **3** `jobLocation`, tous `addressCountry: US` |
| **F** | même libellé, pays issu du seul suffixe (`WA` sous `WA`) | **aucun balisage** |
| + | code postal | vaut preuve |
| + | pays non ambigu (`FR`, `IT`) | aucune preuve exigée |
| + | `countryIntegrity` posée | honorée |
| + | « Seattle, WA » sous `DE` | reste un **conflit**, pas une absence de preuve |

**129 tests web verts**, typecheck 0 erreur.

## Après — vérifié sur les pages SERVIES

| | |
|---|---|
| Fiches conformes | **33 / 33**, 0 échec |
| Cas A (`cmtk0fwif07hus32b25d6ob8k`, « El Segundo, CA » / `CA`) | HTTP **200** · `JobPosting` **0** · `addressCountry:"CA"` **0** |
| Cas A bis (`cmtk0fxca07k2s32byonfzntz`, « Costa Mesa, CA » / `CA`) | HTTP **200** · `JobPosting` **0** · `addressCountry:"CA"` **0** |

### Mesures exigées, par identifiants

| Mesure | Offres |
|---|---:|
| codes collisionnants **avec** preuve indépendante | **4 501** |
| codes collisionnants **sans** provenance suffisante | **4 342** |
| offres **nouvellement inéligibles** par ce correctif | **4 342** (71 961 → 67 794 éligibles, soit −4 167 net après recoupement des motifs) |
| offres **restant balisées** après preuve indépendante | **67 794** |

### Dénominateurs corrigés

| Mesure | Offres |
|---|---:|
| `visibleOnModeCareers` | **78 932** |
| `googleEligible` *(porte technique Mode Careers)* | **67 794** |
| `googleIneligible` | **11 138** |

Par motif : `AMBIGUOUS_COUNTRY_WITHOUT_INDEPENDENT_PROOF` **4 342** · `PHYSICAL_LOCATION_WITHOUT_COUNTRY` 3 937 ·
`NO_REAL_POSTED_DATE` 1 450 · `NO_USABLE_LOCATION` 779 · `DESCRIPTION_TOO_THIN` 477 · `VALID_THROUGH_EXPIRED` 257 ·
`LOCATION_COUNTRY_CONFLICT` 142 · `REMOTE_WITHOUT_ELIGIBILITY_COUNTRY` 23 · `MULTI_LOCATION_COUNTRY_NOT_PROVEN` 11 ·
`OPEN_APPLICATION` 1.

## Restant, déclaré

Les **4 342** offres à code ambigu sans provenance restent **visibles et inéligibles**, identifiants nommés. Leur
résolution passe par le renseignement de `countryIntegrity` à l'ingestion — donc par P7, pas par P5.

**P5 est clos.**

---

# Hotfix terminal — le code postal ne prouve pas à lui seul le pays (2026-09-11)

## Le défaut

`if (job.postalCode?.trim()) return true` était trop permissif. Un code postal est bien **indépendant du
suffixe**, mais sa simple **présence** ne dit rien du pays auquel il appartient.

Les deux cas qui devaient rester refusés l'étaient donc à tort acceptés :
« El Segundo, CA » / pays `CA` / ZIP **90245**, et « Indianapolis, IN » / pays `IN` / ZIP **46204**.

## La règle

`postalCodeConfirms()` exige que le **format** soit connu pour le pays déclaré **et qu'il corresponde** :

| Pays | Format | Le ZIP 90245 le confirme-t-il ? |
|---|---|---|
| `US` | `12345` ou `12345-6789` | oui |
| `CA` | `A1A 1A1` | **non** — d'où le refus |
| `IN` | 6 chiffres | **non** (90245 en a 5) |
| `DE` | 5 chiffres | oui, mais `contradictsCountry` s'exécute avant |

Un format **inconnu ne confirme rien** : on refuse le balisage plutôt que de publier un pays sur une présomption.
**Aucune table postale mondiale n'est construite** — seuls les formats nécessaires pour trancher les codes
ambigus sont encodés.

`countryIntegrity` passe à une **liste POSITIVE explicite** : `RAW_COUNTRY_CODE`, `RAW_COUNTRY`, `VERIFIED`. La
liste négative précédente (« toute valeur autre que AMBIGUOUS ou UNVERIFIED ») était ouverte : un verdict futur
inconnu, ou une valeur écrite par erreur, aurait valu preuve **par défaut**.

## Tests discriminants

| # | Cas | Résultat |
|---|---|---|
| **A** | El Segundo, CA / `CA` / ZIP US 90245 | **aucun JobPosting** |
| **B** | Indianapolis, IN / `IN` / ZIP US 46204 | **aucun JobPosting** |
| **C** | Berlin / `DE` / code postal compatible `10115` | **balisage autorisé** |
| **D** | code postal **incompatible** (`K1A 0B1` sous `DE`) | **aucun balisage** |
| + | code postal canadien valide sous `CA` | accepté |
| + | verdict `countryIntegrity` inconnu | ne prouve rien ; seuls les trois verdicts de la liste prouvent |

**133 tests web verts.**

## Les codes ambigus, par TYPE DE PREUVE RÉEL

| Type de preuve | Offres |
|---|---:|
| `COUNTRY_INTEGRITY_VERIFIED` | **0** — la colonne est vide en production |
| `COUNTRY_SPELLED_OUT` | **0** |
| `POSTAL_COUNTRY_VALIDATED` | **1 633** |
| `NO_INDEPENDENT_PROOF` | **7 210** |
| **Total** | **8 843** = exactement le nombre de codes ambigus en base |

Les quatre groupes sont **exhaustifs et disjoints**. Le « 4 501 avec preuve » agrégé annoncé précédemment était
**gonflé par la règle postale permissive** : le chiffre réel est **1 633**.

> **Piège SQL trouvé en mesurant** : `NOT (col IN (...))` vaut **NULL** quand `col` est NULL. Toutes les lignes à
> `countryIntegrity` vide — soit la totalité — étaient silencieusement exclues des quatre groupes, qui rendaient
> zéro. Rendu NULL-safe par `coalesce`.

## Dénominateurs actualisés

| Mesure | Offres |
|---|---:|
| `visibleOnModeCareers` | **78 932** |
| `googleEligible` *(porte technique Mode Careers)* | **65 099** |
| `googleIneligible` | **13 833** |

Motifs : `AMBIGUOUS_COUNTRY_WITHOUT_INDEPENDENT_PROOF` **7 210** · `PHYSICAL_LOCATION_WITHOUT_COUNTRY` 3 937 ·
`NO_REAL_POSTED_DATE` 1 450 · `NO_USABLE_LOCATION` 779 · `DESCRIPTION_TOO_THIN` 477 · `VALID_THROUGH_EXPIRED` 257 ·
`LOCATION_COUNTRY_CONFLICT` 142 · `REMOTE_WITHOUT_ELIGIBILITY_COUNTRY` 23 ·
`MULTI_LOCATION_COUNTRY_NOT_PROVEN` 11 · `OPEN_APPLICATION` 1.

## Vérifié sur les pages servies

**33 / 33 conformes, 0 échec.** Cas A en direct :

| Offre | HTTP | `JobPosting` | `addressCountry:"CA"` |
|---|---|---|---|
| `cmtk0fwif07hus32b25d6ob8k` (« El Segundo, CA ») | **200** | **0** | **0** |
| `cmtk0fxca07k2s32byonfzntz` (« Costa Mesa, CA ») | **200** | **0** | **0** |

## P5 EST CLOS

Les **7 210** offres sans provenance restent **visibles et inéligibles**. Leur résolution exige que
`countryIntegrity` soit réellement **persistée** par la chaîne d'ingestion — et cela ne se produira **pas tout
seul** : `resolveGeography` produit bien `method` et `sourcePath`, mais cette provenance **n'est pas écrite en
base aujourd'hui**. Le chantier est décrit dans le prérequis P7.
