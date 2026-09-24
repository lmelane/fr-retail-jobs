# Audit RAW — rejets d’identité employeur

**24 septembre 2026 — lecture seule de la production. Politique de publication sans employeur : non décidée.**

## Conclusion

Les rejets actuels ne constituent pas une population d’« offres valides dont l’employeur est inconnu ». Ils mélangent des preuves manquées, des règles de résolution trop grossières, des rattachements réellement contradictoires, des clients non nommés et même des publications qui ne sont plus des offres ouvertes.

**La bonne suite est de corriger les preuves manquées et les défauts de qualification avant de décider du traitement des véritables offres anonymes.** Le diffuseur ne devient jamais l’employeur, la Maison ou le secteur du client par défaut. La décision ne doit pas consister à rendre `companyId` facultatif pour absorber indistinctement ces erreurs.

## Population et méthode

- Point de départ : les **23 sources ayant eu un rejet d’identité dans le RUN du 23 septembre**. Pour chacune, lecture de sa dernière ingestion admise et terminée, avec rapport de complétion scellé. Ce n’est ni un nouveau RUN ni un recensement de tout le catalogue.
- Relevé de population achevé le **24/09/2026 à 06:59:50 UTC**. Les lots datent des 23 et 24 septembre ; leurs révisions de source correspondent aux révisions courantes au relevé. Leurs versions de lecteur peuvent différer. Le résultat d’une ancienne ingestion n’est donc pas présenté comme un nouveau test de la release courante.
- **19 sources conservent 1 413 rejets** : 1 406 pour 18 sources ACTIVE, 7 pour Miu Miu déjà PAUSED. Skechers, Aeropostale, Adidas et Hugo Boss ne conservent plus de rejet d’identité dans le dernier lot retenu. Cela ne certifie pas leurs autres critères.
- Unité de compte : **sortie d’extraction `(source, lot, ordinal)`**, et non offre dédupliquée mondiale. Des annonces peuvent se recouper entre portails. Ces nombres ne sont pas non plus le nombre d’offres actuellement visibles sur le produit.
- **1 413 sorties d’extraction relues**, empreintes du contenu décompressé vérifiées ; rapports scellés également vérifiés. **112 fiches sélectionnées**, couvrant les 19 sources, avec **120 réponses HTTP natives** récupérées et vérifiées par SHA-256. Chaque fiche sélectionnée est reliée à au moins une capture du même lot ; certaines n’ont que le RSS, pas la page de détail.
- Échantillonnage : positions régulièrement espacées dans l’ordre des sorties rejetées, effectifs par source ci-dessous ; intégralité des 30 LVMH ; trois cas supplémentaires Luxe Talent repérés lors du balayage des titres et descriptions (recrutement interne, événement, indice ambigu). Sélection diagnostique, **pas sondage statistique** : aucun taux d’anonymat n’est extrapolé aux 1 413 sorties.
- Comparaison exacte supplémentaire entre objets RAW et réponses natives : **478/478 Luxe Talent, 90/90 Beauty Success, 20/20 Hot Topic, 1/1 Browns et 30/30 LVMH**. Les métadonnées, URL, contenus HTML, JSON embarqués et champs source sont conservés dans l’analyse. Le JSON du diffuseur ou les filtres globaux de page ne sont pas une preuve d’employeur du poste.
- Les transactions SQL sont ouvertes avec `SET TRANSACTION READ ONLY`. Aucun appel HTTP vers les sites métiers, aucune collecte, aucun changement de worker/CRON, aucune migration ni réparation historique pendant cet audit.

### Motifs techniques exacts

| Motif | Sorties rejetées | Sens réel |
|---|---:|---|
| `PORTAL_OWNER_NOT_CERTIFIED` | 1 319 | Le pipeline arrive à la résolution avec le nom du registre ; cela ne dit pas si la réponse native nomme l’employeur. |
| `EMPLOYER_SPELLING_DIVERGED` | 93 | Nom natif déjà extrait, différent de l’attribution/observation historique. Variation typographique, relation entité/marque ou véritable conflit restent à distinguer. |
| `ALIAS_SOURCE_OR_TENANT_CHANGED` | 1 | Nom natif extrait, décision d’alias rattachée à une ancienne empreinte de source. |

**94/1 413 ont donc déjà un employeur dans la sortie d’extraction.** Leur problème n’est pas l’absence d’un nom dans la source.

### Sources et effectifs

Le constat est une synthèse des champs inventoriés et des cas examinés ; il ne classe pas automatiquement chaque offre de la source.

| Source | Rejets | Échantillon | Constat |
|---|---:|---:|---|
| `luxe-talent` | 478 | 23 | Clients non nommés observés ; aussi recrutement interne, indice ambigu et événement ancien. Pas une population homogène. |
| `tiffany-oracle` | 457 | 10 | 412/457 descriptions contiennent « Tiffany » ; champs LegalEmployer et Organization nuls sur 457. Lecteur Oracle sans extraction employeur ; périmètre du portail non renseigné. |
| `lagardere-travel-retail` | 109 | 8 | Entités présentes dans les détails (Extime, Stock, Hachette, Pika…). Le portail couvre aussi l’édition ; son nom de registre est trop étroit. |
| `groupe-printemps` | 100 | 6 | Entité d’accueil dans les détails capturés ; Citadium aussi dans certains titres. Information hors des champs employeur actuellement lus. |
| `beauty-success-geodir` | 90 | 6 | 90 descriptions employeur natives ; 65 Réseau Intégré, 25 Partenaire franchisé. Enseigne attestée ≠ raison sociale du franchisé. |
| `b-s-international` | 62 | 4 | 62 company=« B&S International » déjà extraits ; rattachement historique à B’s/bs-intl.jp contradictoire. |
| `lvmh` | 30 | 30 | 30 maison=null ; descriptions/titres parfois explicites, fonctions de groupe et cas ambigus ; une fiche de test. |
| `funky-buddha` | 23 | 3 | 23 company=« ALTEX S.A. » déjà extraits ; relation à Funky Buddha explicite dans des descriptions. Différence entité/marque ; aussi candidature spontanée. |
| `hot-topic` | 20 | 4 | Employeur explicite dans certaines descriptions ; départements non qualifiés comme employeurs. Pas de preuve pour étendre le même nom aux 20 sans revue. |
| `brown-thomas-taleo` | 12 | 4 | Les 12 détails n’ont pas de script JSON-LD JobPosting détecté ; noms dans les titres/proses de plusieurs concessions. |
| `lagardere-travel-retail-de` | 10 | 3 | Texte « Über uns » nommant Lagardère dans des RSS ; pas de détail de fiche capturé dans ce lot. |
| `lagardere-duty-free` | 9 | 3 | RSS + liste seulement. L’absence dans ce RAW ne prouve pas l’absence de l’employeur dans la fiche complète. |
| `miu-miu` | 7 | 2 | 7 company=« MIU » ; université égyptienne, pas Miu Miu. Source déjà PAUSED. |
| `groupe-chantelle` | 1 | 1 | Une seule offre restante (2565), Entité d’accueil=Groupe Chantelle ; aucune Enseigne/Marque propre à ce poste. Les 36 autres sont publiées. |
| `tapestry` | 1 | 1 | Coach Stores Limited déjà extrait ; alias lié à une ancienne empreinte de source. |
| `thomas-sabo` | 1 | 1 | Nom juridique déjà extrait ; divergence entre « Co. KG » et « Co.KG » dans l’historique. |
| `browns` | 1 | 1 | Département « Farfetch - Private Client » et texte FARFETCH ; mapping de département incomplet. |
| `dr-pierre-ricaud` | 1 | 1 | La fiche native dit que le poste est déjà pourvu. Le rejet d’identité masque une fermeture. |
| `jean-paul-gaultier-5` | 1 | 1 | La fiche native dit que le poste est déjà pourvu. Même cause que Groupe Rocher. |

## 1. Client réellement non nommé dans l’annonce archivée

**Luxe Talent, 21983 — Store Manager Luxury Brand, Londres.** `raw.content.rendered` indique un recrutement pour un client, une marque de mode de luxe, sans la nommer. Le titre, le slug, le contenu, l’extrait, `meta`, le bloc Yoast et les liens ont été examinés. Le JSON-LD décrit un Article et son éditeur Luxe Talent ; il ne nomme pas l’employeur. Le lien TalentClue donne un identifiant de candidature, pas un nom d’entreprise dans les octets disponibles.

La sélection régulière de **20 annonces clients** chez Luxe Talent ne permet pas d’établir de nom d’employeur fiable. Elle comprend des textes anglais, allemands, néerlandais et portugais : par exemple 23196 (marque de lingerie premium, Freienbach), 21983 (Londres), 17422 (client, marque de vêtements, Porto) et 4800 (marque italienne de luxe, Copenhague). Des lieux commerciaux comme Globus, un outlet ou un centre commercial ne deviennent pas l’employeur.

**Limite :** la capture est celle de l’API WordPress contenant le corps et les métadonnées de l’annonce, pas celle des éventuelles destinations de candidature. Aucun nom fiable n’est communiqué dans ce périmètre archivé ; cela ne prouve pas que chaque page externe du parcours est également anonyme. Aucun libellé explicite établissant une volonté de masquer le nom n’a été trouvé dans ces 20 annonces. Ne pas écrire « confidentiel » par déduction.

À l’échelle des **478 RAW WordPress**, aucun `hiringOrganization` n’est présent ; tous comportent un graphe Yoast Article/WebPage/Organization. **478 n’est pas un décompte d’offres anonymes valides** : ce même flux contient les contre-exemples suivants.

- **22678 — Recruitment Consultant Benelux & Business Developer** : le corps décrit le développement des services et de la marque Luxe Talent, au sein de ses équipes. Le cabinet est ici un employeur potentiel explicitement décrit, pas automatiquement le diffuseur d’un client anonyme. Qualification de l’offre et de son périmètre à traiter séparément.
- **22765 — Designer / Personal Assistant** : le texte cite seulement un prénom dans les exigences. C’est un indice ambigu, insuffisant pour inventer une Maison ou identifier une personne/entreprise par rapprochement.
- **20091 — Luxe Talent Job Dating** : événement de recrutement daté des **22–23 février 2024**, encore présent dans les posts `publish`. Ce n’est pas une preuve d’offre de poste actuellement ouverte.

## 2. Identité présente mais non extraite ou non résolue

### Champs et prose non lus

- **Beauty Success 1100957** : `raw.content.rendered` situe le travail chez Beauty Success ; `raw.description_de_lemployeur` présente le groupe NOVI. `company` reste vide. Les **90/90** RAW ont une description employeur mentionnant Beauty Success. Les **25 postes de partenaires franchisés** interdisent cependant de transformer NOVI en employeur juridique par défaut ; l’enseigne et le franchisé sont des faits distincts. Le cas 1097366 nomme l’institut franchisé de Dol-de-Bretagne, sans identifier sa raison sociale dans les champs examinés.
- **Printemps 5794** : la section de fiche **Entité d’accueil** nomme Printemps puis Printemps Vélizy. Elle est dans le HTML natif et ne nourrit pas l’identité normalisée. Le titre du cas 6084 nomme Citadium. Une règle globale « Maison=Printemps » écraserait cette distinction.
- **Chantelle 2565** : `Entité d’accueil` dit « Nous sommes le Groupe Chantelle ». Le lecteur conserve une description de poste mais ne reconnaît comme employeur que les champs Enseigne/Marque/Employeur/Société. Ici le groupe est communiqué, sans marque précise propre à l’offre. La liste générale des six marques n’autorise pas à en choisir une. Le dernier lot compte **36 publications et 1 rejet**, pas 37 employeurs inconnus.
- **Lagardère 9095** : `Entité` nomme **Extime Duty Free Paris**. 10311 nomme **Éditions Stock** ; 10245, **Pika Edition** ; 10391, **LPN** dans les missions. Le portail du registre `lagardere-travel-retail` contient aussi Hachette et ses éditeurs : corriger la qualification du périmètre, pas attribuer tout le flux au travel retail.
- **Hot Topic c1e47619…** : le texte natif annonce explicitement que Hot Topic, Inc. recrute. Le lecteur Lever s’appuie uniquement sur un mapping des départements pour l’employeur ; celui-ci reste vide. D’autres descriptions n’ont pas ce libellé explicite : pas d’extension aveugle aux 20 postes.
- **Browns e0eb0229…** : `raw.categories.department = Farfetch - Private Client`, corps de l’annonce FARFETCH. Le mapping ne couvre pas ce département. Attribuer ce poste à Browns serait incorrect.
- **Tiffany 63615** : `raw.detail.ExternalDescriptionStr` nomme Tiffany & Co. comme recruteur. **412/457** descriptions contiennent la chaîne latine Tiffany ; ce comptage est un signal, pas une certification de chaque attribution. Parmi les 45 autres, certaines nomment la marque dans une autre écriture. Les champs `LegalEmployer` et `Organization` sont nuls sur les 457, malgré des identifiants numériques internes. Le lecteur Oracle ne produit aucun employeur et `portalScope` est nul. L’identité doit venir de preuves qualifiées, jamais d’un identifiant Oracle deviné.
- **Brown Thomas 4239** : titre et corps nomment **COS** pour une concession. D’autres cas nomment Jo Malone ou Trinny London. Les 12 détails rejetés n’offrent pas de script JSON-LD JobPosting détecté ; le lecteur se limite à ce format pour l’identité et ignore ces indices textuels. Une marque de concession ne prouve pas à elle seule la raison sociale du contrat : la relation reste à qualifier.
- **LVMH MHCS02930** : titre et description nomment **Veuve Clicquot**, alors que `raw.maison=null`. **LBMGA00021** nomme La Grande Épicerie de Paris. Les **30/30** cas rejetés ont `maison=null` ; certains désignent une division (LVMH Watches & Jewelry), certains une Maison, certains seulement des fonctions de groupe. Ne pas faire de « LVMH » la Maison de chaque poste ni prendre les marques citées comme exemples pour des employeurs.

### Identité déjà extraite

- **Funky Buddha / ALTEX S.A. — 23 cas** : `raw.company.name` donne ALTEX S.A. Les descriptions grecques examinées présentent Funky Buddha comme marque de cette société. L’historique portait Funky Buddha issu du registre. Il faut représenter/revoir cette relation, pas fusionner aveuglément deux noms ni déclarer l’employeur inconnu. Le cas 744000127388160 est en outre une manifestation d’intérêt/candidature spontanée, pas un poste précis.
- **Thomas Sabo 2573206** : `raw.subcompany` donne `THOMAS SABO GmbH & Co. KG`, contre `Thomas Sabo GmbH & Co.KG` historiquement. Le conflit technique porte sur une variation typographique sourcée, pas sur une entreprise absente.
- **Tapestry JR16149-1** : `raw.detail.hiringOrganization.name = Coach Stores Limited`. L’alias vers Coach porte une ancienne empreinte de source. Réexaminer la portée et la relation juridique/marque de cet alias ; ne pas retirer son garde-fou ni remplacer sa preuve en SQL.

## 3. Contradictions ou preuve insuffisante

- **B&S International — 62 cas** : le RAW SmartRecruiters nomme B&S International, ses activités King of Reach/Capi et des lieux néerlandais. Les attributions historiques examinées pointent vers **B’s**, domaine **bs-intl.jp**. Ce sont des indices contradictoires concrets de rattachement de source, pas une orthographe à absorber. Le blocage est justifié ; la source est encore ACTIVE au relevé. Aucune réattribution historique effectuée.
- **MIU — 7 cas** : le RAW décrit une université privée d’Égypte ; les anciennes attributions étaient Miu Miu. Source déjà PAUSED. Aucun alias MIU→Miu Miu ne doit être créé.
- **Luxe Talent 22765** : l’indice incomplet ne permet pas d’établir une identité fiable.
- **Lagardère Duty Free — 9 cas** : seulement RSS et liste dans le lot. Le cas 9520 ne nomme pas d’employeur dans ces champs ; il serait faux d’en déduire que la fiche complète ne le nomme pas. Le même identifiant 9095 existe aussi sur le portail général, où un détail capturé nomme Extime : c’est une piste de couverture à vérifier, pas une preuve à transférer entre sources sans contrôle.
- **Lagardère Allemagne — 10 cas** : RSS et liste également. Des textes « Über uns » identifient Lagardère Travel Retail, mais toutes les raisons sociales ou enseignes ne sont pas établies. Pas de détail capturé dans ce lot. Les marques citées comme opérées/partenaires ne doivent pas toutes être attribuées au poste.

## 4. Cas qui ne satisfont pas le préalable « offre valide »

- **Groupe Rocher 1434408933** et **Puig 1418803133** : réponse HTML HTTP 200, mais corps explicite **« Désolé, ce poste est déjà pourvu. »**. La liste produit encore une sortie ; le lecteur doit distinguer fiche close et fiche employeur inconnu. Ne pas fabriquer de nom à partir du menu des marques.
- **LVMH TP01660** : description **« Just a smoke test. »**. Ce n’est pas une offre exploitable sous prétexte que le portail est officiel.
- **Luxe Talent 20091** : événement de février 2024, décrit plus haut.
- **Funky Buddha 744000127388160** : candidature spontanée, à distinguer d’une vacance précise.

Ces cas sont des exemples établis, pas une mesure exhaustive des offres invalides du catalogue. Aucun compteur de fermeture ni aucune suppression n’a été déclenché par l’audit.

## Suite recommandée, avant toute politique V1

1. **Corriger les extracteurs sur les preuves existantes**, avec chemins et rôles explicites : champs d’entité de fiche, descriptions employeur, départements relus, titres/proses propres au poste. Aucun balayage global des noms de marques d’une page ; conserver l’abstention et les contradictions.
2. **Traiter les relations et rattachements** : ALTEX/Funky Buddha, Thomas Sabo, alias Tapestry ; réqualifier B&S, maintenir MIU bloquée, décrire correctement le périmètre Lagardère. Un groupe et sa Maison, ou une enseigne et son franchisé, ne sont pas des alias automatiques.
3. **Faire remonter les vrais états de publication** : fermé, événement, test, candidature spontanée. Une présence dans une liste WordPress/SAP/Algolia ne suffit pas à certifier un poste ouvert.
4. **Rejouer les fixtures natives et les tests ciblés**, puis mesurer les rejets résiduels via le pipeline existant. Le présent audit n’autorise aucun patch SQL historique ni contournement d’admission.
5. **Décider ensuite de la V1 pour les offres valides réellement non nommées**, à partir du résidu mesuré. `VERIFIED` concerne la fiabilité de l’identité ; `UNRESOLVED` ne doit inventer ni employeur ni secteur ; `CONFLICTING` reste en revue. La décision de publier les `UNRESOLVED` n’a pas encore été prise.

## Traçabilité

Les fichiers complets sont privés, hors Git, dans `~/.catwalks/search-s1-20260923/identity-raw-audit/` : population scellée, 1 413 extractions, captures natives, observations de résolution, sélection et correspondances. Ils peuvent contenir des contacts publics ou des métadonnées techniques ; ce rapport n’en copie ni les coordonnées ni les secrets. Les scripts de lecture bornée et de vérification sont conservés avec ces preuves ; ils ne sont pas une nouvelle commande de production.

### Lots retenus pour les sources encore rejetées

Chaque effectif se retrouve dans `SourceIngestionCompletion.reportHash` : filtrer les `fates` dont `reason` commence par `EmployerIdentityReviewRequired:`. Lire ensuite les `SourceExtraction` des mêmes ordinaux, sans substituer le dernier RAW courant.

| Source | CaptureBatch | Rapport scellé SHA-256 |
|---|---|---|
| `funky-buddha` | `9837fb9f-1d80-416f-992d-ef3e064f3af3` | `42371498bf76d26ace08bf7a137f8ef5fed6f22178950d15cd8118ed8ba9216e` |
| `beauty-success-geodir` | `363e3aa7-8d42-4534-8aea-d9c90bf071d3` | `c356d6d413f51d2a2d225558bae2c7d4f73897a6fe53c96db51f5d0dccdf1db9` |
| `groupe-chantelle` | `4d0515a9-4182-4253-b840-e1cff2b24a43` | `514e7457bc87460908d075dd13321224967177e101f70df18c781a6ff6016de2` |
| `groupe-printemps` | `8ae4a28c-d8ea-4bb9-a95d-3b016b9b0140` | `7e9e094bcb0755257d478ecadd53a00814f701326fb3299c1b682eed7a33ce9c` |
| `hot-topic` | `4f7f9902-af3b-4ff8-a1ce-f3893045e49b` | `370de2641660a45d4d3e402f0a48a2a2f0545ecfc98647f138796531af59b980` |
| `lagardere-duty-free` | `38d45b53-7820-4812-9532-a1f03ec83459` | `d3530d5328db6f8fa2016fc5c64cdcd7f3af650fd96572b9bf2254f277deb926` |
| `lagardere-travel-retail` | `c4d0a705-f2f4-47c1-afe3-8b3bc825deb8` | `3bc805edda81f6e4b5e885f1ed31470228c0fbe06941bde51afb8ed0a30218c1` |
| `lagardere-travel-retail-de` | `4e9d6ae1-2d6b-4a60-adf7-98525f9a874f` | `ab91744e4e8cf94b9a0b5032621320c004f24d341b54ff312da2a0b82bb31843` |
| `luxe-talent` | `1ff57fee-f841-4170-acf4-2df2ce9263b4` | `ae68411983392296e96a7b34398b972246ccc9ab416ee516984c3589e9047f4e` |
| `tiffany-oracle` | `63e56b7b-221f-40ce-876a-07990596c167` | `8780e1f9074feca9af74de1d573106d43f0302b9418a06cf12d2d70f997c34a0` |
| `tapestry` | `9f9eab3d-26ed-47ec-9367-2d4cf19c92ee` | `e879193e3d1c919f26a48eb12a49639eefcb16282f30405905723f8835856ede` |
| `miu-miu` | `46b67206-a86d-4f31-8811-375d577666a3` | `760af9ce8ab576156162bc4d8287b2181507ae6c72da6981be17388cc1f7a5c1` |
| `thomas-sabo` | `5cac20e4-351b-49c2-bbc3-3bd315b72ce8` | `26292d98ca7744ba1bbcc1aeee4f5b3f9a03915d9cabb30cb58b2df9b5538bec` |
| `browns` | `10ed1bcd-cb03-4dd2-a1b5-0fd23dd2c336` | `8d49cd274ade3a947521d013205a5f08cb5e6b9896f5e3837e92b31466e46f39` |
| `b-s-international` | `de052c0f-3f01-4a20-a13d-dbc0331308c6` | `4585bf7eebbe41cc8c8bbabcf8aab34d4767dab261c3fa57600d0f57a987ef6c` |
| `brown-thomas-taleo` | `e9201d02-4e85-4709-b700-dbaca58698a2` | `bad920b3be8ea1d099dce74dce9f55d595b6c5afb0320ae5c2452d5db2c8638c` |
| `dr-pierre-ricaud` | `6ea1ddc3-3139-4f66-a599-942ac67a5e7e` | `47278c73714a7f5b06e99c039d234fffa6d74a1f5781b359e3745d9c3bc4aa8a` |
| `jean-paul-gaultier-5` | `a292cb9e-fe9b-4ec2-9ad3-298e3c2d4b39` | `7165e2df927d1a1638baa2cd30ff8239b600656aac291e2de155798ca7dde5cc` |
| `lvmh` | `5ddacbaa-2f53-4440-8966-ad3a4e0bc33d` | `6669b957b887f3d8200478cf53e3a4471fe0264570317192133a6f5468ccd74c` |

### Captures des exemples principaux

Les URL identifient la publication ; le verdict repose sur la capture datée, pas sur un nouveau téléchargement de l’URL. Le détail de chaque sélection (112 lignes) est dans `proofs.private.json` : source, lot, ordinal, empreinte d’extraction et identifiants/empreintes de capture.

| Publication | Champ/zone déterminante | Capture native SHA-256 |
|---|---|---|
| [luxe-talent / 21983](https://www.luxetalent.net/store-manager-luxury-brand-london/) | `content.rendered ; meta ; yoast_head_json` | `5c1013f391728d9204df40bad24b2bfd078207c389c57f693e91ba0761513a6c` |
| [luxe-talent / 22678](https://www.luxetalent.net/recruitment-luxe-talent-benelux-bd-recruiter/) | `content.rendered : services et équipe propres` | `18d780fb08da5755f9c5d68edbd5b92379ce00376a6e8af11046b43a07fcf353` |
| [luxe-talent / 20091](https://www.luxetalent.net/luxe-talent-job-dating-london/) | `content.rendered : dates de l’événement` | `e1d7f330ff1904dea67c1c21d68d06be1a1bbd828ef9336782ecf3027eec8c6a` |
| [luxe-talent / 22765](https://www.luxetalent.net/designer-couture-amsterdam-luxe-talent/) | `content.rendered : indice incomplet` | `18d780fb08da5755f9c5d68edbd5b92379ce00376a6e8af11046b43a07fcf353` |
| [beauty-success-geodir / 1100957](https://recrutement.beautysuccess.fr/offres/conseiller-e-estheticien-ne-polyvalent-e-h-f-sainte-maxime-1100957/) | `description_de_lemployeur ; content.rendered ; reseau` | `ddc19bb226f619cf7ce882da7f610fd867b4ecc4f73729a71db8c3bfb83bf4d8` |
| [groupe-printemps / 5794](https://printemps-career.talent-soft.com/offre-de-emploi/emploi-gestionnaire-de-flux-stage-h-f_5794.aspx) | `HTML : Entité d’accueil` | `8b7485918a33c3e2e63b55149a82ceb46f0433d446fa89a86c3adbc20f20a63f` |
| [groupe-chantelle / 2565](https://groupechantelle-recrute.talent-soft.com/offre-de-emploi/emploi-agent-methodes-h-f_2565.aspx) | `HTML : Entité d’accueil` | `34511a3f69aa5070578af571cde2d96ec8bd5ee0e9b8e51fa40a5eee01d178b8` |
| [lagardere-travel-retail / 9095](https://lagardere-recrute.talent-soft.com/offre-de-emploi/emploi-manager-h-f-_9095.aspx) | `HTML : Entité` | `6e5063f284d9defa0d555a03d0599676bf0199054be0ffd86bef141e63af6714` |
| [hot-topic / c1e47619-07b3-4eb0-a945-fc92f17700ed](https://jobs.lever.co/hottopic/c1e47619-07b3-4eb0-a945-fc92f17700ed) | `descriptionPlain` | `f4673d4b5204f618dfa0eaa47a457bf4ba8671d1c480bf4d88606b18cfb3ce30` |
| [browns / e0eb0229-99f4-4c87-8e5d-7f3802266c21](https://jobs.lever.co/farfetch/e0eb0229-99f4-4c87-8e5d-7f3802266c21) | `categories.department ; descriptionPlain` | `3456491d0612228db26b469c0d66ee9de918d69e933cd48f76be29cf32d354ad` |
| [tiffany-oracle / 63615](https://eljs.fa.us2.oraclecloud.com/hcmUI/CandidateExperience/en/sites/CX/job/63615) | `items[].ExternalDescriptionStr` | `a39b33555779fa55bc017ef66c7cdc33650a0ad50381362e4bb3328c74518752` |
| [brown-thomas-taleo / 4239](https://lde.tbe.taleo.net/lde02/ats/careers/v2/viewRequisition?org=ARNOTTS&cws=73&rid=4239) | `HTML : titre ; GET TO KNOW US` | `6adbe9e7662fff7a466415e0d6e586edc76a7d9e85ce38da1937b1747e5ddc37` |
| [thomas-sabo / 2573206](https://thomassabo.jobs.personio.de/job/2573206) | `JSON embarqué Personio : subcompany ; historique observé` | `e7e8114278804dd198395787d391321ca2a49c610e1d738fe71443ed0841df3d` |
| [funky-buddha / 744000150693424](https://jobs.smartrecruiters.com/ALTEXSA/744000150693424) | `company.name ; jobAd.sections` | `ad543ee83d8da419baebc05273a908686226ae3047e646e1ac8a714ef94eeb51` |
| [b-s-international / 744000150675479](https://jobs.smartrecruiters.com/bsinternational/744000150675479) | `company.name ; jobAd.sections` | `a7ebf155b6bb13bf02c2e08994719fb9b8d7b7521684f3930e5bcdcd2023c720` |
| [miu-miu / 743999663570107](https://jobs.smartrecruiters.com/miu/743999663570107) | `company.name ; jobAd.sections` | `c3f0beefc303bef39457f8129d665aa32442f7edb0a31aaee841de0a34d1371f` |
| [tapestry / Manager--Treasury-Operations_JR16149-1](https://tapestry.wd108.myworkdayjobs.com/Tapestry_Careers/job/Greater-London-GBR-United-Kingdom-Corporate-Office/Manager--Treasury-Operations_JR16149-1) | `detail.hiringOrganization.name` | `b69f23e1cd5caf9713cd486d667a23e242a4acc17adc00dce06471a445cdf596` |
| [dr-pierre-ricaud / 1434408933](https://careers.groupe-rocher.com/job/Rennes-CDD-Responsable-Secteur-Est/1434408933/) | `HTML : poste déjà pourvu` | `7fc57ea980ec7ceb62c7c96dd9ddd30b70bd9be94a4aec0e0f6ead0f0f1dfe3e` |
| [jean-paul-gaultier-5 / 1418803133](https://jobs.puig.com/job/Paris-Stage-Conformit%C3%A9-r%C3%A8glementaire-mode-et-d%C3%A9veloppement-durable-Janvier-2027-75/1418803133/) | `HTML : poste déjà pourvu` | `258afc772e6eedbd9d398b528c9a180baeefb795fc7f486e205d265c1a3485dc` |
| [lvmh / MHCS02930](https://emea3.recruitmentplatform.com/apply-app/pages/application-form?jobId=PYZFK026203F3VBQB798N7VG6-1096049&langCode=en_US) | `hits[].name ; description ; maison=null` | `59cc2d8e5a7252c5432a56fa8d3ab2e6c63a1bc9257640c979ea447501b3e405` |
| [lvmh / TP01660](https://lvmh-china.tupu360.com/lvmh/apply?spid=1596429&m=1) | `hits[].description` | `2948d2f286aa5e1a3e330e61c942b807e58fe092c145704aaae70402cf336f95` |

### Empreintes des exports privés

- `population.private.json` : `636405ae182bd421396f7e50994f99802dcd28c2b945126156b75f4309f85207`.
- `outputs.private.jsonl` : `566dbb0faf7b0d4c2598b8d9200319eeea553324a5bf7cb295ea69584671f97f`.
- `native.private.jsonl` : `9a577b61a266da1f19e0bb7bfeb97f4e3a20e0ee007ac8043648bf94f7ac5525`.
- `native-extra.private.jsonl` : `6f96b2a4554ac7824a5244c2c69c9552a3a200e18ea3af0d98c8e4a1fbd220d5`.
- `resolution.private.jsonl` : `2154516662fd553999945789f918e4c82d9b62d8cfffb00f325adcb2b064a968`.
- `sample.private.json` : `0e8def3d809e1f32d0723e9a1b02fcae84929bed737f8f522cb065ba61d9980b`.
- `proofs.private.json` : `980d2ccd5458a4dcab550d640b57cd327919828e630c14f2bec4a03a7c55a538`.

**Sortie du lot : audit documenté, politique non figée, aucun changement de production.** Les corrections applicatives listées restent à réaliser et à mesurer.

## Suite — premiers correctifs mesurés hors réseau

**24 septembre, 07:36 UTC ; développement, sans mutation de production.**
La population ci-dessus reste figée. Le fichier d'export est vérifié par son
empreinte et les détails HTML relus par l'empreinte native de leur capture.
Les 19 révisions de source sont inchangées au nouveau relevé en lecture seule.

Les règles de lecture relues, encore non activées dans le registre, donnent :

| Mesure d'extraction | Résultat |
|---|---:|
| Sorties relues | 1 413 |
| Nom déjà extrait avant correction | 94 |
| Nom extrait après correction | 168 |
| Noms supplémentaires | 74 |
| Relations explicites ALTEX / Funky Buddha conservées | 20 |
| Fermetures SAP correctement reconnues | 2 |
| Événement / fiche de test retenus hors publication | 1 / 1 |
| Candidature spontanée reconnue | 1 |
| Détails TalentSoft relus depuis les captures disponibles dans cet export | 12 |

Les 74 nouvelles identifications se répartissent entre Beauty Success (54),
LVMH (7), Tiffany (6), Lagardère (4), Chantelle (1), Hot Topic (1) et Farfetch (1).
Ce sont des **noms extraits, pas des publications validées** : les 94 noms
déjà présents incluent toujours les vrais conflits B&S/MIU et l'alias Tapestry.
Les 1 241 autres sorties sans nom, après exclusion des quatre publications
invalides, ne constituent pas une mesure d'offres anonymes valides.

La mesure ne rejoue ni admission, ni écriture de déduplication, ni publication.
Elle ne prétend pas lire les détails non exportés. Aucun ancien RAW n'est
réécrit ; les nouveaux champs TalentSoft sont reconstruits en mémoire depuis
les captures natives du même lot, avec URL exacte et empreinte vérifiées.

Les tests défensifs de persistance passent sur base locale jetable : **590 tests
d'intégration**. La variation Thomas Sabo conserve l'entreprise sans créer
d'alias ; la relation ALTEX/Funky Buddha conserve deux entreprises distinctes ;
un faux témoin, une autre entreprise, un nouveau pays ou suffixe restent refusés.

### Consommateurs et étapes restantes

- La fusion SmartRecruiters de description/type est maintenant unique entre
  collecte et rejeu ; l'export auxiliaire devenu inutilisé est retiré.
- Les mappings Lever restent utilisés par des configurations et par
  `remediation/owners.ts` : ils ne sont pas supprimés sans migration de ces consommateurs.
- Le registre LVMH possède encore un alias relu `Groupe Bon Marché` lié à son
  empreinte de configuration. Modifier cette configuration sans revoir cet alias
  introduirait des refus : pas d'activation aveugle des nouvelles règles.
- Restent la qualification et l'activation des règles par source, la revue des
  rattachements/alias (dont Tapestry, B&S et les trois ALTEX sans relation attestée
  dans leur propre RAW), l'enrichissement des cas encore manqués et la mesure
  après ingestion réelle. Aucune politique d'employeur anonyme n'est décidée.
- `main` et les deux images Railway restent sur `504d388` au contrôle CLI ;
  les corrections de cette section n'y sont pas encore livrées.

Fichiers privés du même dossier : `measure-corrections.mts`,
`rules-reviewed.private.json`, `corrections-details.private.json`,
`corrections-summary.json`. Empreinte stable des règles examinées :
`bce8852a5b8d8783ee5a7be4f5c721b9750f37dd534562948a0ec61ef7b0a485`.

### Livraison du code générique, 24 septembre 2026

Le code testé est désormais livré sur l'API et le worker au SHA `f10e1f2` ;
[reçu et validation Railway](search-railway.md). Les configurations de règles
natives et les alias cités ci-dessus n'ont pas été activés par ce lot de recherche.
Les gains d'extraction hors réseau ne sont donc toujours pas comptés comme des
publications acquises. La qualification source par source reste l'étape suivante.

### Validation production des corrections, 24 septembre, 09:52 UTC

**Code livré : `2cc91d8` sur l'API et le worker.** CI développement
[35982734216](https://github.com/lmelane/fr-retail-jobs/actions/runs/35982734216)
et main [35983539433](https://github.com/lmelane/fr-retail-jobs/actions/runs/35983539433)
vertes ; images immuables et preuves dans le
[reçu courant](../../docs/operations/railway/runtime-release.json).
PostgreSQL et son volume inchangés, aucune migration ni réparation historique.

#### Chantelle : règle native activée et ingestion réelle

La règle relue dans l'audit est activée par le registre, puis sa qualification
est renouvelée par `source-add`. Elle exige le témoin explicite
« Nous sommes le Groupe Chantelle » dans `talentsoftDetail.entityDescription`.
Elle ne remplace pas les autres marques du portail par défaut.
Run `03f6832a-06a3-4c0e-8f17-7ef2f91dbbb9` : **COMPLETED**, 40 captures métier,
35 extractions, 35 publications (1 création, 34 mises à jour), 0 erreur,
0 fusion, 0 retenue. L'offre 2565 est attribuée au Groupe Chantelle depuis
son contenu natif. Les autres configurations relues restent à qualifier.

#### Thomas Sabo : collision typographique dans le résolveur commun

Le déploiement `8b4b1bec` a bien échoué : un refus interne subsistait quand
deux identités non revues, issues de la même source, existaient déjà sous
`THOMAS SABO GmbH & Co. KG` et `Thomas Sabo GmbH & Co.KG`.
Le premier correctif ne couvrait pas cette coexistence. Un test d'intégration
a reproduit le refus avant correction ; les 20 tests d'identité passent ensuite.

La correction commune conserve l'identité du poste quand les deux entreprises
sont des identités natives non revues de la même source, sans rattachement
parent, et que seule la typographie autorisée diffère. Elle ne fusionne pas
les entreprises et ne crée pas d'alias. Une entreprise revue, un rattachement
parent, un autre pays ou suffixe juridique restent protégés.

Rejeu production `8f681072-6c2d-41e9-abd5-004ccf81e44a`, déploiement
`c7ae15ba-7326-408c-8837-6188068440c7` : **COMPLETED / exit 0 / SUCCESS**,
41 offres mises à jour, 0 création, 0 fusion, 0 erreur, en 13,988 s.
Le lot métier contient 42 captures et 41 extractions/publications ; les preuves
de préqualification ajoutent 42 captures de lecture et 1 capture d'accès.
Toutes les 85 requêtes vont à `thomassabo.jobs.personio.de`.
L'offre 2573206 conserve `cmu6zrbuj003vponlzm7a9s45` et son entreprise antérieure.
L'ancien échec reste dans l'historique ; il n'est pas requalifié a posteriori.

#### Portée mesurée et résidu

Relevé en lecture seule depuis le 23 septembre à 00:00 UTC : 597 derniers
refus distincts par source/identifiant pour `EMPLOYER_SPELLING_DIVERGED` et
`EMPLOYER_TARGET_MISMATCH`. Avant ce rejeu, 498 avaient été republiés ; 99 ne
l'avaient pas été, dont 92 sous sources ACTIVE : B&S 62, Funky Buddha 23,
Nike 4, Etam 1, Normal 1 et Thomas Sabo 1. Les 7 autres étaient sous MIU PAUSED.
**Un seul cas non republié correspondait à la collision typographique corrigée**,
Thomas Sabo. Les autres familles demandent une revue des preuves et relations,
pas un élargissement de cette équivalence. Ce relevé de refus historiques ne
prouve pas que toutes ces annonces soient encore ouvertes chez leurs sources.

Le CRON normal est restauré (`scheduled`, pause 0, 18 h Europe/Paris, une fois
par jour). Le prochain départ planifié n'est pas encore observé au moment du
reçu : sa configuration est vérifiée, la preuve d'exécution actuelle porte
sur le rejeu borné. API publique, authentification, FR/US, recherche bilingue,
localisation, facettes et fiche passent après livraison.

**Ce lot ne clôture pas l'ensemble de l'audit d'identité.** Les vrais conflits,
alias à revoir et extractions encore manquées restent ouverts. Aucun employeur
anonyme de repli n'a été ajouté. Le retrait d'Elasticsearch concerne le moteur
et l'outillage Catwalks ; un connecteur qui lit l'API native Elasticsearch de
sa source reste nécessaire.
