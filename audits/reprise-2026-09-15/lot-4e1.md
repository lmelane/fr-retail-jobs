# Lot 4E1 — JSON-LD HTML et échéances natives

**Validé localement. Collecte publique Fenwick archivée dans la base de test ; aucune écriture dans le catalogue de production.**

## Défaut d’extraction corrigé

Le lecteur commun exigeait des guillemets autour de `type="application/ld+json"`. Les pages Fenwick utilisent `type=application/ld+json`, une syntaxe autorisée par le [standard HTML](https://html.spec.whatwg.org/multipage/syntax.html#attributes-2). L’ancien constat « zéro bloc » ne démontrait donc pas l’absence de données chez l’éditeur.

Le lecteur utilise maintenant le parseur HTML déjà installé. Il accepte les attributs cités ou non, les espaces autour du signe égal et la casse des noms d’attributs. Les commentaires, les attributs `data-type`, les balises présentes dans une valeur d’attribut et les gabarits inactifs sont exclus. Aucun JavaScript de page n’est exécuté. Le parcours des tableaux et graphes JSON-LD et la récupération existante des caractères de contrôle restent couverts.

Le premier test a montré que les contenus de `template` vivent dans un fragment séparé : vérifier seulement les ancêtres du script ne suffisait pas. Les gabarits sont désormais retirés de l’arbre de lecture avant la sélection des scripts.

## Vérification native Fenwick

La collecte de contrôle récupère **34 offres pour 34 annoncées**, avec **36 réponses natives** archivées : environ 24,4 Mo, soit 3,05 Mo compressés. Chaque offre conserve son unique `JobPosting`, sa date de publication et son échéance. Le rejeu hors réseau produit exactement les mêmes sorties. Cette mesure ne remplace pas la certification complète du protocole d’énumération prévue au lot sources. [Capture et rejeu](preuves/lot-4e1-live.json).

Sur les **34 mêmes pages archivées**, l’ancienne expression régulière trouve zéro bloc ; le lecteur corrigé retrouve 34 publications. Un passage séquentiel local mesure environ 661 ms au total, 18 ms de médiane et 27 ms au 95e percentile. Ce n’est pas une mesure de capacité sous charge. [Comparaison et mesure](preuves/lot-4e1-html-benchmark.json).

Volcanic utilise désormais les dates du `JobPosting` de détail. Les champs de liste `start_date` et `end_date`, dont la sémantique n’a pas été qualifiée, restent dans le RAW sans devenir des dates de publication. La reprise conserve aussi les éventuels nœuds de détail déjà présents. Les 31 RAW historiques du snapshot, qui ne contiennent pas ces nœuds, ne reçoivent pas les nouvelles dates par simple copie.

## Lecteur d’échéance version 4

- **Greenhouse :** `application_deadline`, présent dans le [schéma officiel du Job Board](https://docs.greenhouse.io/job-board.html). Un cas dans le snapshot.
- **Easycruit :** `date_end` du détail XML, ou de la liste lorsque le détail ne le fournit pas. La [documentation Visma](https://community.visma.com/t5/Kennisbank-Youforce-Werving/Opbouw-XML-datafeed/ta-p/650525) décrit la période de publication du flux. Les 50 paires liste/détail du snapshot portent la même date. Le texte libre `ApplicationDeadline` n’est pas converti arbitrairement.
- **TalentView :** `detail.date_end`. Le [bundle public de l’éditeur](https://baccarat.talentview.io/assets/index-2301c0ef.js) affecte ce champ à `JobPosting.validThrough` ; sept valeurs présentes dans les RAW. Il distingue également `job_start`, qui n’est pas utilisé comme échéance.
- **Volcanic :** `postingEvidence.jobPosting.validThrough`, après lecture du détail. Le champ de liste non qualifié ne sert plus d’échéance.

Les dates sans heure conservent la politique déjà testée : expiration lorsque le jour déclaré est terminé dans tous les fuseaux. La fin de contrat Flatchr reste exclue. Le remplissage des caches et la réévaluation de leurs preuves anciennes appartiennent au sous-lot suivant ; cette modification ne réatteste pas le stock historique.

Le rejeu des **85 327 représentations** conserve **50 128 présentations valides**. Le lecteur d’échéance reconnaît **5 167 déclarations**, soit 58 de plus ; 207 sont antérieures à l’instant de référence du 15 septembre à 00:00 UTC. Ces compteurs ne sont ni des écritures ni des fermetures de production. La reconstruction et lecture API de **93 publications dans 31 familles** restent sans écart.

## Validation

**3 009 tests réussis** : 2 287 unitaires agrégateur, 463 d’intégration, 254 API et 5 Python ; deux tests de corpus optionnels ignorés. Les 55 migrations sur base vierge, TypeScript et le build API passent. Les tests d’ingestion vérifient qu’une échéance native passée exclut chacune des quatre nouvelles variantes du catalogue public. [Validation](preuves/lot-4e1-validation.json).

Neuf contre-épreuves réintroduisent le lecteur limité aux guillemets, l’acceptation des gabarits inactifs ou de `data-type`, la perte de chacune des trois échéances nouvellement reconnues, l’échéance de liste Volcanic non qualifiée, une fausse date de liste et la perte du détail Volcanic conservé. Toutes échouent par assertion ; les suites restaurées passent. [Contre-épreuves](preuves/lot-4e1-counterproofs.json).

## Preuves et suite

- [Corpus historique](preuves/lot-4e1-corpus.json), [reconstruction et API](preuves/lot-4e1-shadow.json), [CLI idempotente](preuves/lot-4e1-cli-smoke.json).
- [Inventaire des échéances](preuves/lot-4e1-deadline-inventory.json), [vérifications publiques](preuves/lot-4e1-public-date-check.json).
- [Préservation des travaux initiaux](preuves/lot-4e1-preservation.json).

La reprise des échéances doit faire évoluer `source-expiry.mts` et son moteur existant. La qualification des autres dates, les anciennes captures, les domaines multiples et les pertes historiques restent des conditions de sortie. Aucun statut global « production-ready » n’est donné à ce sous-lot.
