# BLOC 2 — le registre opérationnel des sources

> 2026-09-14, lecture seule, une transaction `REPEATABLE READ`. Tableau complet : `bloc2-registre.md`.
> Données machine : `bloc2-registre.json`.

## Le problème que ce registre résout

`status = ACTIVE` est un statut de **catalogue** : il dit qu'une source appartient au périmètre, jamais
qu'elle a le droit de **fermer** des offres. Les confondre est l'accident nommé par P4 et P7 — une source
dont l'énumération n'est pas prouvée ferme des offres vivantes parce qu'un passage instable ne les a pas
revues. *Le droit de fermer est le pouvoir le plus destructeur du pipeline ; il ne s'accorde que sur preuve.*

## 442 / 442 sources ont une décision

| Mode | Sources | Offres publiées | Ce que le mode autorise |
|---|--:|--:|---|
| **FULL_AUTOMATION** | **50** | 19 120 | collecte · publie · **ferme sur absence prouvée** · rouvre |
| **PUBLISH_NO_CLOSE** | **41** | 29 209 | collecte · publie — **jamais** de fermeture sur absence |
| **EVIDENCE_ONLY** | **344** | 34 925 | collecte bornée et preuves — aucune mutation publique |
| **PAUSED_BLOCKED** | **7** | 756 | rien, motif et condition de reprise obligatoires |

**0 source sans décision. 0 source sans prochaine action.** Aucune n'est admise par défaut : le mode se
gagne sur des conditions mesurées, et une information ABSENTE ne vaut jamais une condition remplie — une
source sans dernier run connu n'est pas « probablement saine », elle est non démontrée.

Les **7 `PAUSED_BLOCKED` sont exactement les 7 sources PAUSED** du catalogue : aucune source active n'est
bloquée par le registre.

## Ce que la génération a trouvé, et qui aurait bloqué 56 sources à tort

La première exécution classait **63** sources en `PAUSED_BLOCKED`, dont **56 ACTIVE** portant le verdict
`ALLOWED (no robots.txt reachable)`.

Cause : j'avais branché le registre sur `isAllowedAccessVerdict`, la porte de **promotion** écrite avant
D62, qui n'accepte qu'un `ALLOWED` nu ou un `ALLOWED (… autorisation …)` nominatif.

**Or D62 a déplacé le fondement** : sur une surface publique d'offres, l'autorisation vient de la décision
sectorielle du propriétaire et du caractère public des annonces ; `robotsObserved` est conservé honnêtement
mais **ne décide plus seul**. `accessDecision()` le dit explicitement — un robots absent ou injoignable
n'interdit rien par lui-même.

Deux chemins de décision divergeaient donc sur la même question. Le registre lit désormais la chaîne D62, et
conserve `promouvableParLaPorteD60` en colonne séparée : *les deux faits sont vrais et distincts — « la
collecte est autorisée » n'est pas « la promotion est possible en l'état ».*

## Cohérence des certifications

Les **93 sources certifiées** ont toutes une identité couvrant la configuration **actuelle** (D59) :
50 en `FULL_AUTOMATION`, 41 en `PUBLISH_NO_CLOSE`, 2 en `EVIDENCE_ONLY`.

Les 41 retenues le sont pour un motif nommé, jamais par prudence vague :

| Motif | Sources |
|---|--:|
| droit d'attester une absence refusé | 24 |
| énumération non prouvée (`complete ≠ true`) | 17 |

*Ce sont des sources dont les offres sont réelles et doivent être publiées, mais dont l'absence d'un passage
ne prouve rien — exactement le cas Hugo Boss / Skechers.*

## Les périmètres se DÉRIVENT du registre

```
source-registry.mts --mode=FULL_AUTOMATION   → 50 clés, prêtes à être passées à une exécution bornée
```

Aucune liste n'est maintenue à la main dans plusieurs fichiers : *une liste recopiée diverge, une liste
dérivée ne peut pas.*

## Ce qui n'a PAS été fait, volontairement

Aucune source non certifiée n'a été transformée en certifiée pour gonfler un compteur. Les 344
`EVIDENCE_ONLY` restent non certifiées et le registre dit, pour chacune, l'action qui la ferait progresser.
