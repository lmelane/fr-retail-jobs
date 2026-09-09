# Diagnostic intermédiaire du run normal — 9 septembre 2026

À 00:21 Paris : 403 des 424 sources actives ont un compte rendu depuis le début du run. Les 21 autres incluent les plus gros portails ; aucun total final n'est certifié ici.

## Une dette technique de preuve, pas une conclusion d’échec chez les sources

122 Teamtailor, 29 SuccessFactors, 23 Personio et 22 Recruitee ont chacun `complete=false`, sans erreur technique rapportée. Le dispatcher `normalizeAdapterResult` refuse, correctement, de certifier une liste nue sans total déclaré ni preuve de terminaison. Or ces quatre adaptateurs renvoient encore une liste nue. **Attendre un second run ne suffira pas à produire cette preuve manquante.**

Il ne faut pas ajouter `complete=true` autour des adaptateurs existants :

- Teamtailor arrête sa pagination quand une page n'apporte pas de nouvel ID, même si un `next_url` existe ; il peut également atteindre MAX_PAGES sans signaler de troncature. Il faut enregistrer la terminaison du curseur, les cycles, les lignes rejetées et la portée du flux.
- SuccessFactors RMK calcule un total par locale mais le perd à la sortie ; la somme des comptes de locales ne peut pas être comparée directement au nombre mondial de réquisitions uniques. Il faut attester chaque locale et distinguer doublons de traduction et trous de pagination.
- Personio peut convertir une réponse sans racine XML attendue en liste vide ; la stratégie française puis langue par défaut doit préserver l'ensemble des postes et enrichir leurs descriptions sans en perdre.
- Recruitee convertit une réponse sans tableau `offers` en liste vide. Valider la forme et le contrat du flux complet avant toute attestation.

## Qualité avant et après canonicalisation

Les taux `countryRate` du run comptent le champ `NormalizedJob.country` avant canonicalisation. Le compteur `france` utilise une autre règle, tenant aussi compte du lieu. Nocibé rapporte ainsi 0 % de pays à l'entrée et 246 offres classées France ; ces mesures ne sont pas interchangeables. Le futur tableau de qualité doit exposer séparément présence source, canonicalisation, preuve et contradictions.

Ce dossier est un diagnostic en lecture seule. Aucun adaptateur ni compteur n'est modifié par cette analyse. Prochain lot proposé : terminaison et attestation Teamtailor, puis RMK, Personio et Recruitee, sur réponses réelles archivées et avec refus de clôture pour tout parcours incomplet.
