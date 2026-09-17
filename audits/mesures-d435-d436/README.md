# Mesures D-435 / D-436 — dimensions du catalogue

Sondes rejouables, en LECTURE SEULE, écrites pendant les mesures des 14 et
15/09/2026. Elles vivent ici et non dans `/tmp` : un chiffre qu'on ne peut pas
recompter n'est pas une preuve.

## Comment les exécuter

Par le lanceur borné, jamais en pointant une base à la main :

```
python3 apps/aggregator/scripts/ops/db.py readonly node audits/mesures-d435-d436/<fichier>.mjs
```

Les `.sql` se lisent avec le même lanceur. Aucune de ces sondes n'écrit : les
mots-clés d'écriture y sont absents, et la connexion passe par une transaction
en lecture seule.

## Cinq sondes volontairement absentes du dépôt

`q.mjs`, `d437-echantillon.mjs`, `d437-couverture-simulee.mjs`,
`d437-enum-cles-raw.mjs` et `d437-geo-plausibilite.mjs` restent NON SUIVIES.

Elles construisent leur URL de connexion avec l'hôte, le port et le nom de la
base **écrits en dur** — seul le mot de passe vient de l'environnement. Publier
ces fichiers exposerait l'adresse d'une base de production, de façon
irréversible : un dépôt garde ce qu'on y grave, même après suppression.

Ce n'est pas une critique de leur contenu. `q.mjs` est même mieux protégé que la
moyenne : il REFUSE tout mot-clé d'écriture avant d'ouvrir la connexion et force
`default_transaction_read_only`. C'est l'adresse qui ne doit pas être publiée,
pas la sonde.

Pour les verser au dépôt, remplacer l'URL littérale par la connexion héritée de
l'environnement — la forme qu'emploient déjà les dix-sept sondes présentes ici,
qui instancient `PrismaClient` sans lui passer d'adresse.
