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

La source technique, le diffuseur, l’employeur réel, la Maison/enseigne et le
groupe sont des rôles distincts. Un diffuseur identifié ne prouve pas l’identité
du client pour lequel il recrute. Une entreprise dont l’enrichissement est
incomplet peut néanmoins être identifiée de manière fiable dans la publication.

**Décision du 24 septembre : la politique de publication sans employeur identifié
reste indécise.** Elle doit s’appuyer sur l’[audit des RAW réellement rejetés](../../audits/2026-09-24/employer-raw-audit.md),
en distinguant information non communiquée, information perdue par le pipeline
et identité contradictoire ou ambiguë. La proposition antérieure de publication
sur la seule qualification du diffuseur n’est pas une décision validée.

- Un employeur explicitement nommé dans la fiche ou le flux reste prioritaire.
  TalentSoft peut lire les champs de fiche `Enseigne`, `Marque`, `Employeur` et
  `Société` avec `employerFromDetail: true`, même lorsque le RSS contient déjà la
  description. La valeur, le libellé, l’URL et l’empreinte de la page sont retenus
  et le rejeu utilise la même lecture. Les filtres globaux ne servent pas de preuve.
- `VERIFIED` désigne une identité suffisamment établie pour publier avec
  l’employeur ; ce n’est pas une exigence d’enrichissement complet de sa société.
- `UNRESOLVED` désigne une identité qui reste à établir. Sa publication éventuelle
  dépendra d’une politique produit explicite. Aucune Maison ni aucun secteur du
  client ne sont déduits par défaut du diffuseur.
- `CONFLICTING` impose un blocage/revue ; une contradiction ne se résout pas en
  effaçant simplement l’employeur pour publier anonymement.
- Le terme « confidentiel » exige une indication explicite de la source. Un nom
  absent de l’extraction, voire d’un RSS, ne prouve ni son absence de la fiche
  complète ni une volonté de le masquer.

**État d’implémentation :** la lecture TalentSoft est implémentée et testée.
Les trois états ci-dessus expriment la règle métier convenue ; ils ne constituent
pas une migration déjà livrée. Le schéma actuel exige `Job.companyId` et le traite
comme l’employeur. Renseigner ce champ avec le cabinet pour faire passer le garde
serait une fausse attribution. Le prototype de publication sans employeur a été
retiré du travail actif ; aucune migration ou activation en production n’a eu lieu.

Les corrections en cours récupèrent les preuves natives manquées et traitent
les conflits de résolution, sans ouvrir globalement la publication. Une offre
close, un événement ou une fiche de test ne devient pas valide parce que son
diffuseur est connu. Toute évolution ultérieure devra préserver les preuves par
publication, éviter les fusions entre clients anonymes et ne rechercher une
Maison que lorsqu’elle est attestée. Aucun changement de collecte, de données
historiques, de `/offres` ou de matching n’est inclus dans cet audit.

### Lecture des identités et retrait des mécanismes remplacés

`Source.config.nativeEmployerRules` porte des règles relues pour une source,
versionnées dans sa `SourceRevision`. Chaque règle nomme les chemins RAW et les
énoncés exacts attendus, ainsi que le rôle `EMPLOYER`, `BRAND` ou `GROUP`.
Toutes ses conditions doivent être satisfaites ; les noms doivent figurer dans
les énoncés témoins. Un menu, un code de département ou la seule présence d'un
nom ailleurs dans le RAW ne suffisent pas. Une contradiction reste en attente.
Le même interpréteur intervient dans la collecte et dans le rejeu conservé.
En collecte, la pause est vérifiée avant lecture réseau ; le rejeu hors ligne
n'ouvre aucun accès métier.

TalentSoft conserve la section d'entité propre à la fiche, séparée des filtres
globaux. Une description générale du groupe ne remplace pas une enseigne déjà
nommée dans un champ du poste. Les relations marque/entité juridique sont des
preuves distinctes, pas des alias : le résolveur peut remplacer une ancienne
attribution **issue du registre** uniquement si la relation vers cette marque
est relue dans le RAW du poste avec les règles de la source courante. Il ne
fusionne aucune entreprise et n'invente aucun lien de groupe.

La comparaison typographique d'un poste déjà connu tolère les espaces après un
point d'abréviation, sans changer les clés d'alias ni supprimer raison sociale,
numéro ou pays. Les pages SAP indiquant explicitement une fermeture utilisent
le circuit de clôture existant ; événement et test sont retenus hors publication,
sans être assimilés à une fermeture employeur. La candidature spontanée reste
le type `OPEN_APPLICATION` déjà existant.

Avant suppression : inventorier les consommateurs, remplacer leur chemin,
passer les tests défensifs, puis retirer l'ancien code. Le constructeur de texte
SmartRecruiters n'est plus une API séparée du lecteur conservé : une seule
fusion applique description et type d'opportunité aux deux chemins. Les mappings
Lever encore consommés par le registre et la reprise, les anciennes formes RAW
encore relues, ainsi que `/offres` et le matching ne sont pas du code mort.

**État : code local testé, configurations de source non activées en production.**
La mesure hors réseau est dans la suite de l'[audit RAW](../../audits/2026-09-24/employer-raw-audit.md).

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

### Pays d’une offre : les lieux déclarés contrôlent le pays retenu (D-440, D-442, D-450, D-454)

La projection (`publication/content.ts`) retient d’abord un pays par la chaîne habituelle : champ pays de l’adaptateur, lecture du libellé, replis. Elle le confronte ensuite aux lieux déclarés par le lecteur qualifié de la source (`normalize/declaredPlaceCountry.ts`), dans cet ordre.

1. **Territoire (D-442 §2, D-450, D-454).** Si le champ pays de l’offre désigne un pays englobant de la liste fermée et que chaque lieu déclaré nomme explicitement un même territoire qui a son propre marché et que ce pays englobe, ce territoire est retenu. La liste est fermée : Hong Kong et Taïwan sous `CN`, Porto Rico sous `US`. Le territoire est nommé par son nom, jamais par un code : « HK », « PR » ou « PRI » ne comptent pas, et « PR » est aussi l’abréviation postale de Porto Rico dans une adresse américaine. Il est lu dans l’un des champs de nom de lieu que garde le lecteur de faits : libellé (Arc’teryx : « Hong Kong » ; Tapestry : « San Juan, Puerto Rico, USA (Coach 6102 San Juan-Coach) »), ville (LuxExperience, lieu JSON-LD sans nom : « Hong Kong SAR, China ») ou région (Skechers : « Puerto Rico »). Un libellé hiérarchique nomme le territoire par son nom (D-454 §1) : dans « USCA > USA > Puerto Rico > San Juan 5008 - KIP » (VF Corporation), « > » sépare les niveaux du lieu ; il ne l’énumère pas. Il ne se lit que dans le libellé, et ni la lecture ordinaire des libellés ni la contradiction ne le lisent. La hiérarchie est crue telle quelle : « APAC > Hong Kong > Shenzhen » passerait à Hong Kong ; les 903 lieux hiérarchiques de l’instantané (VF Corporation, JanSport) ont tous la forme « RÉGION > PAYS > État > boutique ». Ensemble, ces champs ne nomment aucun autre pays que le pays englobant et ce territoire, et le champ pays du lieu, s’il existe, dit le pays englobant ou le territoire (une valeur remplie mais illisible, « MEX » ou « U.K. », empêche la règle ; « N/A » ou « - » disent l’absence). Un lieu mixte ne passe pas au territoire (D-454 §2) : deux gardes écartent un lieu qui n’est visiblement pas tout entier dans le territoire : un segment est une subdivision du pays englobant, par les seules tables États-Unis et Canada (« Carolina, Puerto Rico » sous l’État « North Carolina », « Miami, FL / Puerto Rico ») ; un champ énumère plusieurs lieux (« / », « | », « · », « ; ») dont un ne nomme pas le territoire (« Shanghai / Hong Kong » reste en Chine). Ce sont des heuristiques, sans répertoire de villes : une ville du pays englobant qui n’est pas une subdivision (« Orlando, San Juan, Puerto Rico », « Hong Kong, Shenzhen »), une énumération par conjonction ou un code postal continental seul passent encore, et la première garde est inerte sous `CN`. Aucune offre dans ces cas le 24/09/2026. Un lieu écarté garde le verdict qu’il avait avant la règle : le pays retenu, ou l’abstention quand ses lieux déclarés nomment un autre pays. Prix assumé par D-454 §2 : « Florida, Puerto Rico », commune de l’île homonyme d’un État, ne passe pas au territoire (abstention pour un libellé seul, États-Unis quand le lieu dit aussi « United States »). Conséquence du texte de R-125 §4 (« un lieu qui ne nomme pas le territoire »), non présentée au CEO comme telle : « Central | Hong Kong » reste en Chine (0 offre). Macao n’a pas de marché et n’y figure pas : sous le champ `CN`, « Macau SAR, China » reste en Chine. La règle ne s’applique jamais sous un autre champ pays, ni sans champ pays : le « Macau » de Gironde déclaré sous `FR` reste en France, et Porto Rico ne se lit que sous `US`. Le pays étant lu dans un nom de lieu, aucune preuve `countryIntegrity` n’est persistée. Limite connue, non tranchée : un lieu qui ne nomme le territoire que dans son propre champ pays tombe dans l’abstention (0 offre publiable concernée le 24/09/2026). Limite documentée par D-454 : un nom de boutique (« Outlet Puerto Rico Prime ») n’est pas un segment de lieu, et cette offre Puma reste aux États-Unis.
2. **Adresse (D-442 §1).** Si tous les lieux déclarés nomment un même pays différent du pays retenu, la publication se contredit. Quand le pays retenu vient d’un code pays (le champ pays de l’offre est un code), le pays de l’adresse l’emporte si chaque lieu porte au moins trois champs qui le nomment, sans champ qui en nomme un autre : nom du pays (un code à deux ou trois lettres ne compte pas), État ou province des tables États-Unis et Canada, code postal au format du pays (ZIP américain et code britannique seulement, séparateurs ignorés), libellé. La preuve persistée est `RAW_COUNTRY` quand chaque lieu porte le nom du pays, sinon aucune. La subdivision est lue sous le pays de l’adresse. Question ouverte, sans offre concernée le 24/09/2026 : Porto Rico emploie des ZIP américains, si bien qu’un magasin de l’île codé `PR` dont la source écrit « United States », « 00925 » et « San Juan, PR, United States » réunit trois champs pour les États-Unis et y est classé.
3. **Abstention (D-440, D-435).** Dans les autres cas de contradiction, dont ceux qui ont moins de trois champs concordants, aucun pays ni subdivision n’est retenu : l’offre reste servie par son lien, hors de tout marché.

Les coordonnées ne sont pas lues en pays. Sans lieux déclarés, rien ne change. Le rejeu des RAW de production du 24/09/2026 (`audits/2026-09-24/scripts/pays-signaux-contradictoires.mts`, instantané lu à 18:06 UTC, 77 026 offres publiables) donne exactement 50 changements. Les 22 de D-442 et de sa précision du même jour : 12 offres Ulta de Porto Rico aux États-Unis, 1 boutique Foot Locker de Slough des États-Unis au Royaume-Uni, 6 offres Arc’teryx et 3 offres LuxExperience de la Chine à Hong Kong. Les 21 consignées par D-450 : 16 offres Skechers et 5 offres Tapestry des États-Unis à Porto Rico. Les 7 de D-454 §1 : 7 offres VF Corporation (Kipling, Vans), des États-Unis à Porto Rico par leur libellé hiérarchique. Aucune autre offre ne change, et le marché PR compte alors 87 offres publiables (71 stockées, moins 12, plus 28). La section C du rejeu confirme par la projection réelle les changements des familles dont le RAW est capturé ; les offres Workday (Tapestry, VF Corporation) ne sont couvertes que par la section B. Restent au marché des États-Unis, dans le même instantané, des offres situées à Porto Rico que la règle ne lit pas (section « B. Porto Rico sous US » du rejeu ; limite documentée par D-454) : 1 qui le nomme hors d’un segment (la boutique Puma ci-dessus), 7 qui n’en portent que l’abréviation « PR » ou le code postal (3 knitwell-us-retail « …, PR 00918 » ou « …, PR 00717 », 2 aeropostale, 2 urbn-hub), que la règle exclut, 21 qui ne nomment qu’un lieu de l’île (Barceloneta, Bayamón, Mayagüez, Montehiedra, Las Catalinas, « Ponce, US »), et 5 « San Juan, US », homonyme d’une ville du Texas.

**État : codé et testé, committé sur `development` le 25/09/2026 ; livraison en production : voir le reçu de release (`docs/operations/railway/runtime-release.json`).**

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
