# P4 — fraîcheur, fermetures, retraits, réouvertures, invérifiables

Mesures du 2026-09-11, production en **lecture seule**, une transaction `RepeatableRead` dont le niveau est
asserté. Aucune écriture de production dans ce lot ; les scénarios de cycle de vie tournent sur clone.

| Note | Contenu |
|---|---|
| [01-avant.md](01-avant.md) | l'état mesuré, les trois causes établies, ce qui était déjà correct |
| [02-semantique-des-champs.md](02-semantique-des-champs.md) | le sens des sept champs, qui peut les modifier, les cinq dates à ne pas confondre |
| [03-cadences-mesurees.md](03-cadences-mesurees.md) | les rythmes réels par famille ATS et les délais déduits |
| [04-matrice-des-situations.md](04-matrice-des-situations.md) | les douze situations, l'état produit, les mutations autorisées |
| [05-dossiers-saks-tapestry-knitwell-vf.md](05-dossiers-saks-tapestry-knitwell-vf.md) | les quatre dossiers, cycle de vie uniquement |
| [06-bilan.md](06-bilan.md) | le bilan structuré, le tableau final et le GO / NO-GO pour P5 |

| Preuve | Produite par |
|---|---|
| `lifecycle-reference.json` | `scripts/coverage/lifecycle-reference.mts` |
| `hold-blast-radius.json` | `scripts/coverage/hold-blast-radius.mts` |
| `attestation-replay.json` | `scripts/coverage/attestation-replay.mts` |
| `freshness-cadence.json` | `scripts/coverage/freshness-cadence.mts` |
| `unverifiable-register.json` | `scripts/coverage/unverifiable-register.mts` |
| `lifecycle-scenarios.json` | `scripts/ops/lifecycle-scenarios.mts` (clone) |

Le registre porte 1 062 dossiers. `--csv=` en produit la même liste pour lecture en tableur, non versionnée (les
CSV sont ignorés par `.gitignore`). Il est **régénérable** à tout moment et n'est donc pas une source de vérité :
la base l'est.
