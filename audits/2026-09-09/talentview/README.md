# TalentView — pagination perdue démontrée et corrigée

Le code lisait seulement `/campaigns?company_website_id=…`, soit **la première page de dix offres**, puis déclarait la collecte terminée sans attestation d'exhaustivité. Le paramètre de pagination renseigné dans la configuration Promod n'était pas consommé par cet adaptateur. Il ne lisait également que le premier site public du tenant.

Le client JavaScript officiel de Sud Express donne le protocole : `offset_start=1`, incrément de **1** par page, `display_mode=list`, poursuite tant que la réponse contient au moins dix campagnes. Empreinte et URL du client, ainsi que les SourceRun antérieurs, dans `protocol-proof.json`. L'annuaire FashionJobs a servi à trouver la Maison ; aucune offre FashionJobs collectée.

## Preuve réelle

| Portail | Dernier run : offres collectées | Lecture directe corrigée | Pays retournés |
|---|---:|---:|---|
| La Redoute TalentView | 5 | 5 | Espagne, Portugal, Royaume-Uni |
| Promod | 10 | 53 | France, Suisse |
| Baccarat | 10 | 19 | France |
| Jules | 10 | 73 | France, Belgique |
| Sud Express — candidat non activé | aucune source | 68 (contre 10 par l'ancien adaptateur) | France |

**35 → 150** offres enumerées pour les quatre sources déjà actives. Cela ne signifie pas 115 nouvelles offres nettes en base : d'anciennes représentations peuvent déjà y être conservées. Sud Express ajoute un potentiel direct de 68 offres, sans activation à ce stade. Le tenant La Redoute lu n'expose aucune offre France dans cette photographie ; il faut rechercher les autres portails de la Maison et ne pas confondre tenant exhaustif et couverture mondiale de la marque.

`live-validation.json` conserve tous les identifiants, pays, URLs et empreintes. Lecture sans descriptions complètes et **sans écriture de production**, tous les sites publics, aucun filtre France.

## Correctif

L'adaptateur lit chaque page de chaque site public. Il conserve une identité de campagne unique à travers les sites locaux. Un plafond, une répétition de page ou une répétition d'identifiant dans un même site interdit l'attestation d'absence. Une réponse ou une campagne invalide échoue explicitement. Aucun total n'est fabriqué. Une panne réseau reste un échec et ne devient jamais une liste vide.

Le format AdapterResult porte enfin `complete` et `truncated` ; le même contrôle d'attestation du pipeline s'applique. Les règles de pays, salaire, remote, dates, descriptions et RAW restent celles du pipeline commun. Le client officiel confirme la route `jobs/:slug` : pas de changement d'URL fondé sur un simple gabarit de configuration.

## Validation et statut

Cinq témoins échouent sur l'ancien adaptateur. **1 450 tests unitaires et le typecheck des deux apps passent**. La validation directe finit les cinq tenants sans troncature. La CI et le déploiement sont suivis dans le reçu de livraison. Aucun ingest n'est lancé par ce correctif et les SourceRun historiques ne sont pas réécrits.
