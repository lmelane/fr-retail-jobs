# Lot 3 — faits RAW et réattestation

**Validé localement le 15 septembre 2026. Migrations et reprise du stock de production non exécutées.**

## Résultat

L’ingestion, la reprise et l’API partagent désormais le même contrat de salaire, diplôme, mode de travail et localisations. Chaque publication conserve les valeurs lues, leurs chemins RAW, les problèmes rencontrés et la version du lecteur. L’API choisit les faits de la publication qui fournit le lien de candidature encore disponible. Le [contrat maintenu](../../docs/architecture/source-facts.md) précise les lecteurs, les absences et les commandes.

Les montants sont stockés en `NUMERIC(24,6)` et conservés comme chaînes décimales dans le contrat complet. Une fourchette sans période connue reste partielle. Plusieurs zones salariales ou localisations restent distinctes. Une réattestation peut corriger ou effacer les anciennes valeurs de sa publication ; une source secondaire ne les complète plus artificiellement.

## Suppressions et corrections

- Suppression de l’extraction salariale textuelle qui déduisait la période du montant et supposait l’euro, de ses coercitions inutilisées et du moteur de télétravail fondé sur des mentions dans la description.
- Suppression de la reprise additive `backfill-workplace.mts`, remplacée par une reprise versionnée avec prévisualisation, contrôle du RAW et journal par correction.
- Suppression de l’ancienne correspondance TalentView : le code `1` désigne du télétravail ponctuel. Le dictionnaire public et deux annonces ont été vérifiés ; les codes monétaires inconnus ne deviennent pas EUR.
- Suppression du calcul inutilisé des coordonnées Phenom et du script ponctuel de témoins devenu obsolète. Ses résultats initiaux restent une preuve datée.
- Remplacement de `CLAUDE.md`, qui contenait des consignes et états contradictoires, par un index des contrats maintenus.
- Validation et sélection explicite des champs publics du cache : un cache mal formé est refusé ; des propriétés supplémentaires ne peuvent pas exposer de données internes.

## Mesures sur le RAW conservé

Le rejeu traite **85 327 représentations**, issues de 42 familles présentes dans ce stock. Ce ne sont pas 85 327 offres uniques et cette mesure ne certifie pas les tenants.

| Lecture | Représentations |
|---|---:|
| Montant salarial positif lu | 3 845 |
| Dont montant décimal | 1 322 |
| Montant avec devise et période connues | 2 206 |
| Salaire déclaré, y compris termes textuels | 4 416 |
| Diplôme natif déclaré | 1 450 |
| Mode de travail déclaré | 8 294 |
| Localisation déclarée | 60 093 |
| Plusieurs localisations | 3 031 |
| Au moins une paire de coordonnées exploitable | 24 884 |
| RAW absent ou inexploitable comme objet | 1 154 |

Deux conflits explicites sont signalés : une fourchette salariale et un mode de travail. Les tableaux détaillent aussi `NOT_OBSERVED`, `UNINTERPRETED` et les valeurs masquées. Un lecteur non qualifié n’est pas compté comme une information absente chez l’employeur. Les mesures par pays utilisent le pays actuellement stocké comme segment ; elles ne certifient pas sa géographie.

La lecture pure des quatre dimensions prend environ 5 secondes sur cette machine, hors écriture PostgreSQL. Les caches sérialisés représentent 76 355 121 octets, avec un percentile 95 de 1 313 octets et un maximum de 46 098 octets. Ce n’est pas une mesure de latence de l’API ou de volume PostgreSQL indexé.

## Validation et audit défensif

| Contrôle | Résultat |
|---|---:|
| Migrations depuis une base PostgreSQL neuve | 52 appliquées |
| Tests unitaires agrégateur | 2 149 réussis |
| Tests d’intégration agrégateur | 464 réussis |
| Tests API | 249 réussis ; 2 corpus optionnels ignorés |
| Tests Python des outils ops | 5 réussis |
| Total exécuté dans la suite complète | **2 867 réussis** |
| TypeScript et build API | Réussis |
| Schéma migrations ↔ Prisma | Aucune dérive |
| Reprise sur 257 cas RAW, 42 familles | 257 corrections journalisées, aucun écart |
| Second passage des deux plans | 257 corrections déjà appliquées, aucune écriture supplémentaire |
| CLI preview → apply → répétition → nouveau preview | 1 → 1 → 0 nouvelle correction → 0 restant |
| Rapport d’exploitation avec états des faits | Exécuté sur la base isolée |

Les tests de transaction conservent une véritable erreur d’écriture pour vérifier le rollback. Une valeur salariale hors capacité ne fait plus échouer toute l’offre : elle est conservée dans la preuve et signalée comme invalide.

Huit contre-épreuves réintroduisent successivement l’arrondi salarial, la perte d’une latitude nulle valide, l’interprétation positive de booléens faux, l’absence de correction des valeurs périmées, l’application d’un plan sur un RAW modifié, le salaire d’une autre publication, l’acceptation d’un cache mal formé et l’exposition de propriétés internes. Chacune provoque une assertion rouge ; les fichiers sont restaurés exactement et les suites ciblées repassent. Le durcissement final du cache public a été suivi des contrôles TypeScript et des tests de lecteurs et d’API.

## Limites et passage au lot suivant

Les migrations doivent précéder le nouveau code, puis le stock doit être repris avant la bascule des champs publics. Aucun cache historique n’est supposé rempli. Les 1 154 RAW manquants demandent une recollecte ; les lecteurs et codes propriétaires non qualifiés restent explicitement non interprétés. Leur qualification par tenant appartient au parcours des sources.

Les coordonnées et codes postaux simples ne représentent qu’un lieu unique. Les colonnes historiques de ville/pays, les facettes multi-lieux, le filtrage géographique du télétravail et l’interface du contrat complet sont traités dans les lots de recherche et de contexte pays. Le lot 4 doit d’abord sécuriser l’identité et supprimer les fusions automatiques fondées sur des titres proches.

Les 86 fichiers préexistants restent préservés : 85 ont une empreinte inchangée ; le manifeste de dépendances porte les changements des lots précédents et conserve les trois commandes utilisateur hors de ce commit. Aucun push ni déploiement n’est réalisé dans ce lot.

## Preuves

- [Validation et empreintes des journaux](preuves/lot-3-validation.json)
- [Rejeu complet et compteurs par famille et segment pays](preuves/lot-3-corpus.json)
- [Reprise de 257 cas en base isolée](preuves/lot-3-shadow-repair.json)
- [CLI, schéma et rapport d’exploitation](preuves/lot-3-cli-smoke.json)
- [Contre-épreuves](preuves/lot-3-counterproofs.json)
- [Qualification du vocabulaire TalentView](preuves/lot-3-talentview-vocabulary.json)
- [Préservation des travaux préexistants](preuves/lot-3-preservation.json)
