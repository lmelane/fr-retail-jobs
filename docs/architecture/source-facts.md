# Faits issus des publications

Le RAW conservé est l’entrée de référence. `JobSource.sourceFacts` est un cache recalculable ; il ne remplace ni les réponses natives, ni les sorties d’extraction, ni les observations historiques décrites dans le [contrat de capture](native-capture.md).

## Chemin actif

1. L’adaptateur conserve son RAW et les identifiants de capture.
2. `upsertDeduplicated` archive l’observation, puis appelle une seule fois `readSourceFacts` avec le type réel de source et ce RAW.
3. Chaque lecteur consulte des chemins propres à la source. Il conserve valeur native, chemin, problèmes et état de lecture.
4. La publication reçoit le cache complet. La projection simple du Job est créée ou réattestée par la publication qui fournit le lien de candidature.
5. L’API choisit une publication encore disponible et sert ses faits avec son lien. Elle refuse un cache inconnu ou mal formé.

Le cache contient `version`, `sourceType` et `inputHash`. Cette dernière empreinte décrit le JSON d’entrée avec un ordre stable des clés ; les empreintes des octets natifs restent dans le stockage de capture. Un changement de lecteur nécessite une nouvelle version et un replay.

## États de lecture

| État | Sens |
|---|---|
| `DECLARED` | Valeur lue dans un champ qualifié de cette publication |
| `NOT_OBSERVED` | Rien d’exploitable dans les chemins examinés du RAW conservé |
| `INPUT_MISSING` | RAW absent ou inexploitable comme objet |
| `UNINTERPRETED` | Lecteur, code, unité ou structure non qualifiés |
| `INVALID` | Valeur contraire au contrat de stockage ou de coordonnées |
| `CONFLICT` | Preuves incompatibles, par exemple bornes salariales inversées |
| `WITHHELD_BY_SOURCE` | Indication explicite de non-affichage |

`NOT_OBSERVED` ne signifie pas que l’employeur ne publie jamais cette information. Un ancien adaptateur peut avoir perdu une partie de la réponse ; seul un RAW natif disponible permet de la relire.

## Identité de l’employeur et de l’annonceur

Décision produit du 24 septembre : l’absence de Maison précise ne suffit pas à
rejeter une offre valide provenant d’un annonceur identifié. Le portail, le
recruteur et l’employeur sont des rôles distincts.

- Un employeur explicitement nommé dans la fiche ou le flux reste prioritaire.
  TalentSoft peut lire les champs de fiche `Enseigne`, `Marque`, `Employeur` et
  `Société` avec `employerFromDetail: true`, même lorsque le RSS contient déjà la
  description. La valeur, le libellé, l’URL et l’empreinte de la page sont retenus
  et le rejeu utilise la même lecture. Les filtres globaux ne servent pas de preuve.
- Un groupe officiel dont la Maison n’est pas nommée doit pouvoir publier avec
  l’indication « Publiée par [groupe] — Maison non précisée ».
- Un cabinet identifié doit pouvoir publier avec l’indication « Recrutée par
  [cabinet] — employeur non communiqué ». Le terme « confidentiel » exige que la
  source le dise ; une simple absence n’est pas une demande de confidentialité.
- Une identité contradictoire ou un annonceur non qualifié reste un vrai blocage.

**État d’implémentation :** la lecture TalentSoft est implémentée et testée ; le
modèle de publication via un annonceur est une cible à implémenter. Le schéma
actuel exige encore `Job.companyId` et le traite comme l’employeur. Renseigner
ce champ avec le cabinet pour faire passer le garde serait une fausse attribution.
Aucun changement d’admission ne l’autorise aujourd’hui.

La réalisation doit séparer l’employeur facultatif de l’annonceur qualifié, porter
le rôle et les preuves dans la publication native, puis les servir explicitement
sur `/emplois`. Recherche de métier et de lieu : offre éligible. Recherche ou filtre
d’une Maison précise : uniquement si cette Maison est prouvée. Aucun secteur du
cabinet hérité par son client ; aucune fusion entre clients anonymes sur la seule
base d’un titre, d’une ville ou du cabinet. Les identifiants natifs restent la clé.
La collecte et les contrôles d’accès restent inchangés. Les nouvelles règles ne
réattribuent pas les offres historiques et ne rouvrent pas le chantier `/offres`
ou matching. Le modèle, l’API et l’affichage doivent être validés ensemble avant
activation des publications dont l’employeur n’est pas nommé.

## Salaires

- Stockage PostgreSQL `NUMERIC(24,6)` ; aucune troncature entière, conversion de devise ou annualisation.
- Les montants du contrat complet sont des chaînes décimales exactes. Une précision hors capacité de stockage est signalée ; elle ne fait pas perdre l’offre.
- Montant, devise, période, libellé de zone et indication brut/net restent associés. Plusieurs zones salariales Ashby restent plusieurs fourchettes ; les actions et primes ne sont pas mélangées au salaire.
- Magnet fournit des montants d’origine et des montants convertis : le lecteur utilise `min_src` / `max_src` avec leur période d’origine.
- Les valeurs textuelles comme « To be negotiated » restent textuelles. Les zéros placeholders ne deviennent pas une rémunération publiée.
- Les drapeaux d’affichage Flatchr et Ashby sont respectés. L’absence de période iCIMS et l’intervalle Lever non qualifié `bi-week-salary` ne deviennent pas `YEAR`.
- La projection numérique de l’API n’est remplie que pour une fourchette unique, avec devise et période connues, représentable exactement en nombre JSON. Le contrat complet conserve les informations partielles.

L’ancienne extraction qui choisissait une période selon la taille du montant et imposait l’euro a été supprimée. La présence d’un montant dans une description ne suffit plus à inventer devise ou période.

## Télétravail et diplômes

Recruitee publie des choix indépendants `on_site`, `hybrid` et `remote` : tous les choix vrais sont conservés, conformément à sa [documentation de flux](https://docs.recruitee.com/docs/feed). Un booléen `remote=false` seul ne prouve pas un poste exclusivement sur site. Le lecteur ne classe pas les mentions incidentes d’équipes distantes ou de technologies hybrides dans les descriptions.

Le télétravail ponctuel a sa propre valeur. TalentView utilise `0=non proposé`, `1=ponctuel`, `2=partiel`, `3=total` ; le dictionnaire public a été vérifié avec les pages [Baccarat](https://baccarat.talentview.io/jobs/2q8mc6) et [La Redoute](https://laredoute-talent.talentview.io/jobs/knhb4i). La [preuve de qualification](../../audits/reprise-2026-09-15/preuves/lot-3-talentview-vocabulary.json) identifie le bundle consulté. L’ancienne correspondance TalentView `1 → sur site` a été supprimée.

Les diplômes conservent leur référentiel et leurs mots natifs. `WTTJ:no_diploma` porte une absence explicite d’exigence de diplôme. Une information manquante reste manquante. Le drapeau Greenhouse imposant de renseigner sa formation dans un formulaire ne devient pas un niveau d’études.

## Localisations

Les listes de lieux qualifiées sont conservées, avec leur provenance. Les lieux supplémentaires n’héritent pas du pays du premier lieu. Le lecteur ne parcourt pas les offres voisines et ne confond pas un emplacement d’entreprise avec une localisation du poste.

Les coordonnées sont lues par paire, avec un ordre qualifié par source : champs latitude/longitude, texte Magnet et TalentRecruiter, GeoJSON Talent Funnel, `latlong` Phenom. Les coordonnées hors limites ou incomplètes ne sont pas publiées. Une latitude nulle est valide ; la paire `(0,0)` demande une vérification. Les codes postaux restent du texte. Les lieux explicitement masqués sont retenus hors de la réponse publique.

Les colonnes simples de coordonnées et de code postal ne représentent qu’un lieu unique. La liste complète reste dans les faits. Le cloisonnement par pays et les facettes multi-lieux sont livrés dans le lot de recherche, après le traitement de l’identité des publications.

## Réattestation et reprise

Une nouvelle observation remplace le cache de sa publication. La publication propriétaire peut aussi effacer une ancienne valeur devenue absente, invalide ou contradictoire. Une source secondaire ne complète pas artificiellement son salaire, son diplôme ou ses coordonnées. Les observations précédentes restent conservées.

La reprise utilise le même lecteur et la même projection que l’ingestion. Depuis `apps/aggregator`, dans une base de test ou une session de maintenance explicitement configurée :

```sh
npx tsx scripts/ops/source-facts.mts --keys=source-a,source-b --out=/chemin/prive/plan.json
npx tsx scripts/ops/source-facts.mts --apply --plan=/chemin/prive/plan.json --hash=empreinte-du-plan
```

La prévisualisation lit au maximum 250 représentations par défaut, 1 000 avec `--limit`, et donne `nextCursor` à reprendre par `--cursor`. Elle omet les corrections inutiles. Le fichier privé contient les différences, les faits proposés et leurs preuves. L’application enregistre le plan immuable, verrouille les écritures, relit les entrées et le propriétaire, puis journalise chaque correction dans `DataCorrection`. Elle refuse un RAW, un propriétaire ou un lecteur modifiés. Chaque groupe de Job est atomique et un redémarrage ignore les groupes déjà terminés.

## Livraison et limites

Les migrations de précision décimale et de cache doivent précéder le déploiement du lecteur. Le stock doit être repris avant d’exposer les nouveaux champs sur le site. Un cache absent ne déclenche aucun repli vers un ancien salaire sans preuve.

Les lecteurs non qualifiés restent identifiés comme tels. Les sources avec RAW manquant nécessitent une nouvelle collecte. Les noms de villes ne sont pas transformés ici en identifiants géographiques, et « remote » ne donne aucun droit implicite de recherche mondiale. Les contrats par pays, l’interface des faits complets et le classement des deux origines restent les lots suivants.
