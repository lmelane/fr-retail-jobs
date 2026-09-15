> **Archive de preuve datée.** Les chemins de cycle de vie cités ici ont été remplacés au lot 1 du 15 septembre 2026. Ce document conserve les constats de son audit ; utiliser la [documentation d’exploitation maintenue](../../../../apps/aggregator/scripts/ops/README.md) pour les commandes actuelles.

# BLOC 6 — observabilité et alertes

## Les canaux, et leur état réel

| Variable | État sur `catwalks-aggregator` |
|---|---|
| `BREVO_API_KEY` | **posée** |
| `BREVO_SENDER_EMAIL` | **posée** |
| `ALERT_EMAIL` | **posée** |
| `HEALTHCHECK_PING_URL` | **posée** — ping externe vérifié : **HTTP 200** |

*Seuls les NOMS des variables sont lus, jamais leurs valeurs* — `railway-service.py variable-names`. Une
preuve d'exploitation ne doit pas pouvoir devenir une fuite de secret parce qu'on a voulu vérifier qu'un
secret existait.

## Le rapport d'exploitation (`operations-report.mts`)

Le digest Brevo alerte quand une source **se dégrade** : c'est le bon déclencheur pour un courriel, mais il
laisse sans réponse la question quotidienne — *où en est le catalogue maintenant ?*

**Une source silencieuse depuis huit jours n'a jamais « échoué ».** Elle n'a rien produit, aucune alerte ne
se déclenche sur un silence, et c'est précisément ce que FashionJobs a fait pendant des jours (D24). Le
rapport le mesure donc explicitement.

État au 2026-09-14 :

| | |
|---|--:|
| Sources suivies | **444** |
| FULL_AUTOMATION · PUBLISH_NO_CLOSE · EVIDENCE_ONLY · PAUSED_BLOCKED | 50 · 41 · 346 · 7 |
| **Silencieuses depuis plus de 7 jours** | **9** |
| **Sans aucun run** | **2** (les deux sources tout juste enregistrées) |
| Offres publiées | 84 010 représentations |
| 429 sur 48 h | **0** |
| Retenues | 176 |
| **Refus d'identité** | **21** |
| Fermetures sur 48 h | 16 |
| Stockage chaud | 133 249 lignes, **586 Mo** |
| Archives distantes | 0 — **stockage non configuré** |

## Un défaut de lecture corrigé dans le rapport lui-même

`job.write_failed` mélangeait **deux faits qui n'appellent pas la même réaction** : une porte d'identité qui
refuse (comportement voulu — P8 : « aucune identité inventée ») et une écriture réellement en échec (défaut
à corriger).

Vérifié sur 48 h : les 21 événements sont **tous** des `EmployerIdentityReviewRequired` — `saks` 9,
`mecca` 9, `knitwell-us-retail` 3. *Les compter ensemble ferait lire une garde saine comme une panne*, et
c'est exactement le genre de chiffre qui fait chercher un bug inexistant. La colonne s'appelle désormais
« refus d'identité ».

## Déclencheurs couverts

| Alerte | Déclencheur | Canal | État |
|---|---|---|---|
| Source DEGRADED / BROKEN | fin de run | digest Brevo | armé, clé posée |
| Run non exécuté | absence de ping | healthchecks.io | armé, **ping 200 vérifié** |
| Volume effondré | `< 50 %` du dernier run productif | `attestation.ts` — refus d'attester | actif (P8/D51) |
| Fermeture au-delà de la garde | ratio de clôture | `closureRatioPolicy` | actif |
| Déploiement pendant un run | préflight | `deploy-guard.py` | actif, **a déjà refusé** |
| Silence prolongé | aucun run depuis N heures | rapport d'exploitation | **mesuré : 9 sources > 7 j** |
| Premier échec d'archive | étape de rétention | verdict fail-closed | **prouvé sur 6 contre-exemples (P8)** |
| Échec de restauration | étape `RESTORE_SAMPLE` | verdict fail-closed | **prouvé** |
| 429 / quota | `--stop-on-first-429` | garde dans la commande déployée | actif |

**Ce qui n'est PAS encore testé en conditions réelles** : l'envoi effectif d'un courriel Brevo sur une source
dégradée. Le provoquer demanderait de dégrader volontairement une source de production — une fausse mutation
que le brief interdit. Le chemin est armé et son absence de clé dégrade proprement en « pas d'email ».
