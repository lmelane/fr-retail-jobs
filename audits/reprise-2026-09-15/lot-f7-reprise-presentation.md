# Lot F7 — Reprise de la projection de publication, et le catalogue redevenu servable

Date : 2026-09-17. Fait suite à l'application des 37 migrations en attente sur la base
de production, le matin même.

## Le défaut, et comment il s'est manifesté

La migration `20260915230000_publication_presentation` ajoute la colonne
`JobSource.presentation`. Elle la crée **vide** : aucune reprise de données ne la
remplit. Mesuré après l'application : **85 327 représentations actives sur 85 327**
sans projection.

Conséquence côté produit, et elle est totale. `toRow` (`apps/api/lib/jobs.ts:301`)
refuse de servir une offre dont il ne peut pas construire la présentation et lève
`PUBLICATION_PRESENTATION_REBUILD_REQUIRED` ; la route traduit en 503 ; le visiteur lit
« La recherche est momentanément indisponible ». Le nouveau moteur `/emplois` ne servait
donc **aucune** offre.

Ce refus est le bon comportement : servir une offre à demi projetée vaudrait moins que
rien, et le code s'interdit explicitement de faire passer une panne pour « aucun
résultat ». **Le défaut est l'absence de reprise, jamais le garde-fou.**

Le catalogue historique `/offres` n'était pas touché : il n'utilise pas cette projection.
La production est restée servie pendant tout l'épisode.

## Le diagnostic, et ce qu'il a coûté de le mener

Le 503 masquait sa cause : `jobs.ts:425` enveloppe **toute** exception dans
`DatabaseUnavailableError`. Le message rendu accusait donc la base — laquelle répondait
parfaitement, 83 431 offres actives comptées en lecture seule.

Trois pistes fausses ont été écartées par mesure, non par raisonnement :

- la clé d'accès : valide, `/api/marches` répondait 200 avec ses douze marchés ;
- le registre des marchés : « FR » bien présent ;
- les tables du schéma : `DirectOffer` et `CompanyAlias` présentes.

La cause n'est apparue qu'en rejouant `getJobs` hors du serveur, ce qui a rendu l'erreur
d'origine. Première tentative fautive de ma part : un appel sans l'objet `filtres`, qui a
produit un `Cannot read properties of undefined (reading 'pays')` — **une erreur de ma
sonde, pas du code de production**, qu'il aurait été facile de graver comme un défaut.

## La reprise

[`scripts/ops/reprise-presentation.mts`](../../apps/aggregator/scripts/ops/reprise-presentation.mts),
versionné et rejouable.

La présentation est une « replaceable projection of one observation, never a source of
publisher truth » : chacun de ses 42 champs existe déjà sur la ligne `Job`. Le script
**recopie**, il ne déduit ni ne corrige rien — une reprise qui « améliore » les données au
passage serait une modification silencieuse du catalogue.

Trois champs font exception et sont pris sur la représentation, non sur l'offre :
`externalId`, `canonicalExternalId`, `canonicalSourceKey` et `url`. Le contrat les compare
à la ligne `JobSource` elle-même ; les recopier depuis `Job` ferait échouer toute
représentation secondaire, dont l'URL diffère de l'URL canonique.

**L'empreinte d'entrée.** `publicationContentOf` exige un `inputHash` de 64 caractères
hexadécimaux. Quand la représentation porte des `sourceFacts`, le cache doit reprendre
LEUR empreinte, à l'identique. Mesuré ici : `sourceFacts` est nul sur les 85 327 lignes,
la comparaison est donc sautée par le contrat (`publication-presentation.ts:39`) mais
l'empreinte reste obligatoire. Elle est calculée sur le contenu projeté — elle n'a rien à
égaler, et reste recalculable à l'identique par un rejeu.

**`readerVersion`, et une correction d'audit.** La première version du script y inscrivait
`reprise-presentation-<date>`, au motif — exact — que le contrat n'exige qu'une chaîne non
vide (`publication-presentation.ts:36`) et qu'aucun consommateur ne compare cette valeur
aujourd'hui. L'audit défensif a montré que les deux constats, tout en étant vrais, ne
suffisent pas : **cinq champs de la même forme SONT comparés à `captureReaderRevision()`**
pour détecter une péremption (`sourceAccess.ts:24`, `sourceCertification.ts:20`,
`sourceAccessEvidence.ts:34`, `sourceExpiry.ts:312`, `facts/repair.ts:51`). Que la
présentation y échappe est une propriété du code d'aujourd'hui, pas une garantie du schéma.
Le jour où ce contrôle est ajouté — le geste naturel vu ses cinq frères — 85 327 lignes
porteraient une révision qui n'a jamais existé et qu'aucun rejeu ne peut reproduire.

Corrigé : le script inscrit désormais la révision réelle, et la trace de la reprise part
dans une clé **séparée** (`reprise`), hors des `values` que le contrat valide. Les lignes
déjà écrites gardent l'ancienne chaîne ; une re-projection les corrigerait, et rien
aujourd'hui ne la rend nécessaire.

## Le garde-fou du script lui-même

Chaque projection est **relue par `publicationContentOf` avant d'être écrite** — le
contrat même que l'API applique. Une ligne refusée n'est pas écrite : elle est comptée et
nommée. Écrire une projection invalide ne ferait que déplacer le 503 de la lecture vers
l'écriture.

Le script n'écrit que `presentation`, et seulement là où elle est nulle. Il ne crée ni ne
supprime aucune ligne, ne ferme ni ne rouvre aucune offre, ne touche ni source, ni
décision, ni preuve. Son mode par défaut ne fait que compter.

## Preuves d'exécution

| | |
|---|---:|
| répétition à blanc, avant écriture | 500 / 500 acceptées, **0 refus** |
| écriture réelle | **85 327 / 85 327**, 0 refus, 0 échec |
| relecture exhaustive du stock par le contrat | **85 327 / 85 327**, 0 refusée |
| représentations secondaires contrôlées | 6 / 6 relues |

La relecture exhaustive est la preuve qui compte : ce n'est pas un échantillon, c'est tout
le stock passé au contrat que l'API applique à chaque requête.

Durée : environ 40 minutes, 36 lignes par seconde. La production est restée servie pendant
toute l'opération — `catwalks.io/offres` vérifié à 200 pendant et après.

## Le résultat, mesuré sur l'environnement de développement

L'API sert les sept marchés en 0,1 à 0,4 s. Le catalogue est vivant : **11 026 offres en
France, 36 942 aux États-Unis, 3 475 en Allemagne**.

Les sept langues servent le catalogue :

| route | titre servi |
|---|---|
| `/emplois` | 11 026 offres |
| `/en/emplois` | 11,026 openings |
| `/de/emplois` | 11 026 Stellenangebote |
| `/it/emplois` | 11 026 offerte |
| `/es/emplois` | 11 026 ofertas |
| `/nl/emplois` | 11 026 vacatures |
| `/zh-CN/emplois` | 11 026 个职位 |

L'anglais formate `11,026` avec la virgule anglo-saxonne quand les autres emploient
l'espace : la localisation des nombres suit la langue servie. Une fiche réelle s'ouvre en
0,65 s, avec son employeur et son parcours de candidature.

## Lire une clé que Vercel ne rend plus

[`scripts/ops/lire-variable-service.mts`](../../apps/aggregator/scripts/ops/lire-variable-service.mts).

Une variable Vercel de type `Secret` n'est plus jamais lisible : ni au tableau de bord, ni
par `vercel env ls`, ni par `vercel env pull` qui écrit `[SENSITIVE]`. C'est une
protection, pas un défaut — et elle bloquait la pose de `CATALOGUE_API_KEY` sur
l'environnement de préversion.

Une clé d'accès a **deux porteurs** : le client qui l'envoie et le service qui la vérifie.
Celle-ci vit aussi sur Railway, côté API, et Railway rend ses valeurs à qui détient le
jeton du projet. C'est la source, pas un miroir.

Piège rencontré, qui aurait coûté du temps : le `.env.local` du site porte bien ces deux
variables, mais avec des valeurs de **développement** — `localhost:3010` et une clé de
test, inutilisables sur Vercel qui ne joint pas la machine du propriétaire.

Le script écrit la valeur dans un **fichier** en `-rw-------`, jamais sur la sortie standard :
un secret imprimé dans un terminal se retrouve dans l'historique du shell et les journaux de
session.

**Le garde de destination, corrigé après audit.** Sa première version comparait le texte de
l'argument (`includes('catwalks-job-aggregator')`, `startsWith('.')`). L'audit a trouvé deux
contournements sans la moindre malice : un nom relatif nu — `cle.txt` — ne commence pas par
un point et ne contient pas le nom du dépôt, mais s'écrit dans le dossier courant, qui est le
dépôt quand on lance un script du dépôt ; et un lien symbolique posé dehors et pointant dedans
passe le test de la chaîne, après quoi l'écriture suit le lien.

Le garde résout désormais le dossier de destination en chemin absolu **sans lien**, et le
compare à la racine du dépôt résolue de la même façon. Les deux contournements sont fermés,
**prouvés par tentative** : nom relatif nu refusé, lien symbolique refusé, aucun fichier créé
dans les deux cas. Le cas légitime reste servi. Un garde qui juge une apparence ne garde rien.

## Audit défensif

Mené en position adverse sur les deux scripts, avec pour consigne explicite de chercher une
écriture hors périmètre, une fuite de secret et un contournement de garde.

**Aucun CRITICAL.** Vérifié contre le code, pas contre les commentaires : le script de reprise
ne porte **qu'un seul appel Prisma capable d'écrire**, sur la seule colonne `presentation`,
sous `if (ECRIRE)` — aucun `create`, `delete`, `deleteMany`, `updateMany`, aucune autre colonne,
aucune autre table. Le mode par défaut n'écrit rien. La pagination est pilotée par la mutation
elle-même (`WHERE presentation IS NULL` réévalué à chaque lot, sans décalage), donc une
interruption laisse un état cohérent et un rejeu ne revisite jamais une ligne écrite.

**Deux findings corrigés**, tous deux décrits plus haut : `readerVersion` fabriqué (HIGH), et
le garde de destination jugeant une chaîne plutôt qu'un chemin résolu (MEDIUM).

**Deux findings de forme corrigés** : le bloc de sortie du mode comptage mêlait un compte sur
toute la table et un taux de refus sur un seul lot, sans dire que le second est un échantillon —
un lecteur pressé aurait lu « 0 refus sur 85 327 ». Et le commentaire de l'empreinte laissait
croire qu'elle couvrait toute la projection, alors qu'elle porte sur l'identifiant et les
`values` seulement.

**Vérifié sain, et c'est le plus important pour le secret** : la valeur ne transite ni par la
sortie standard, ni par un message d'erreur, ni par une trace de pile, ni par l'historique du
shell — elle n'est jamais un argument de ligne de commande. Le transport Railway refuse de
suivre une redirection pour ne pas livrer le jeton, et n'écrit jamais la réponse d'erreur du
serveur. L'interpolation du code Python passe par `JSON.stringify` à chacun de ses quatre
points : aucune injection trouvée.

## Écarts connus, non traités ici

- **Le 503 masque sa cause.** `jobs.ts:425` enveloppe toute exception dans
  `DatabaseUnavailableError`, ce qui a fait accuser la base pendant tout le diagnostic. Le
  comportement public est bon (ne jamais déguiser une panne en « aucun résultat »), mais
  l'exploitant mérite de lire la cause réelle dans le journal. À reprendre.
- **Cinq sondes de mesure restent hors du dépôt** : elles écrivent en dur l'hôte, le port
  et le nom de la base de production dans leur URL de connexion. Le
  [README des mesures](../mesures-d435-d436/README.md) dit comment les verser.
- La reprise ne re-projette pas une représentation déjà projetée. Une évolution de
  `PRESENTATION_VERSION` exigera une reprise distincte, qui devra cibler les projections
  périmées — cas non couvert par ce script, délibérément.
