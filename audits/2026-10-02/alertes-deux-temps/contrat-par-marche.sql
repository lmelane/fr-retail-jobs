-- D-515 §3 — LE CONTRAT PAR MARCHÉ : comment il est reconnu sur chaque marché servi, et ce qui reste non reconnu alors que
-- l'offre le dit dans sa langue. LECTURE SEULE. Jamais entre 15:30 et 18:30 UTC (RUN quotidien).
-- Rejouer (depuis le checkout de référence, qui porte les accès) :
--   cd ~/Downloads/catwalks-job-aggregator && python3 apps/aggregator/scripts/ops/db.py readonly sh -c 'psql "$DATABASE_URL" -X -A -F"	" -f -' < audits/2026-10-02/alertes-deux-temps/contrat-par-marche.sql
-- « Servie » = même définition que audits/2026-10-02/r143-filtres-alertes/couverture.sql (publicJobSql + pays d'un marché).
-- contrat = "employmentTerm" (la durée : PERMANENT, FIXED_TERM, TEMPORARY), ce que le filtre « CDI » et ses équivalents lisent.
SET statement_timeout = '240s';
\set servie 'SELECT j.id, j."countryCode", j."canonicalSourceKey", j."employmentTerm", j."programType", j."engagementType", j."workTime", j."rawContract", j."rawWorkingTime", j.title, j.description, j.language, CASE WHEN j."countryCode" IN (''FR'',''MC'') THEN ''FR'' WHEN j."countryCode" IN (''GB'',''IE'') THEN ''GB'' WHEN j."countryCode" IN (''DE'',''AT'') THEN ''DE'' ELSE j."countryCode" END AS marche FROM "Job" j WHERE j."isActive" AND j."mergedIntoId" IS NULL AND j."countryCode" IN (''JP'',''KR'',''PT'',''MX'',''SG'',''DK'',''HK'',''PL'',''SE'',''CL'',''TR'',''TH'',''MY'',''AE'',''NO'',''TW'',''BR'',''GR'',''ZA'',''VN'',''CZ'',''PE'',''NZ'',''HU'',''SA'',''RO'',''PR'',''PH'',''LU'',''US'',''FR'',''MC'',''GB'',''IE'',''CA'',''DE'',''AT'',''IT'',''ES'',''NL'',''AU'',''CH'',''BE'',''CN'') AND EXISTS (SELECT 1 FROM "JobSource" s0 WHERE s0."jobId" = j.id AND s0."isActive" AND (s0."expiresAt" IS NULL OR s0."expiresAt" > now()))'

-- Q1 par marché : couverture du contrat (durée), répartition des valeurs, temps de travail
SELECT marche, count(*) n,
  round(100.0 * count(*) FILTER (WHERE "employmentTerm" IS NOT NULL) / count(*), 1) contrat_pct,
  count(*) FILTER (WHERE "employmentTerm" = 'PERMANENT') permanent,
  count(*) FILTER (WHERE "employmentTerm" = 'FIXED_TERM') duree_determinee,
  count(*) FILTER (WHERE "employmentTerm" = 'TEMPORARY') temporaire,
  round(100.0 * count(*) FILTER (WHERE "workTime" IS NOT NULL) / count(*), 1) temps_pct,
  count(*) FILTER (WHERE "rawContract" IS NOT NULL AND "employmentTerm" IS NULL) brut_sans_duree
FROM (:servie) servie GROUP BY 1 ORDER BY 2 DESC;

-- Q2 libellés bruts de contrat sans durée reconnue, par marché (les 6 plus fréquents de chaque marché)
SELECT marche, "rawContract", n FROM (
  SELECT marche, "rawContract", count(*) n, row_number() OVER (PARTITION BY marche ORDER BY count(*) DESC) r
  FROM (:servie) servie WHERE "rawContract" IS NOT NULL AND "employmentTerm" IS NULL GROUP BY 1, 2) x
WHERE r <= 6 ORDER BY marche, n DESC;

-- Q3 expressions natives d'un emploi PERMANENT dans la description d'une offre SANS durée reconnue, par marché.
-- Une expression = une formule qui qualifie un contrat ou un poste dans sa langue (jamais un mot nu).
SELECT marche, count(*) sans_duree,
  count(*) FILTER (WHERE description ~* 'tempo indeterminato') it_indeterminato,
  count(*) FILTER (WHERE description ~* 'festanstellung|unbefristete[nrs]? (arbeits|anstellung|stelle|vertrag|beschäftigung)') de_festanstellung,
  count(*) FILTER (WHERE description ~* '(contrato|tiempo|plazo) (por tiempo |a plazo |de trabajo )?indefinido|tiempo indeterminado|plazo indeterminado') es_indefinido,
  count(*) FILTER (WHERE description ~* 'prazo indeterminado|contrato efetivo|efetiva[cç][aã]o|regime clt|\mclt\M') pt_efetivo,
  count(*) FILTER (WHERE description ~* 'vast (contract|dienstverband)|vaste (aanstelling|baan)|onbepaalde tijd') nl_vast,
  count(*) FILTER (WHERE description ~* 'permanent,? (full[ -]time |part[ -]time )?(position|role|contract|employment|job|opportunity)|(full|part)[ -]time,? permanent|permanent (full|part)[ -]time') en_permanent,
  count(*) FILTER (WHERE description ~* 'open[ -]ended contract|indefinite (contract|term)|permanent contract') en_contrat,
  count(*) FILTER (WHERE description ~* 'czas nieokre[sś]lony') pl,
  count(*) FILTER (WHERE description ~* 'dobu neur[cč]itou') cs,
  count(*) FILTER (WHERE description ~* 'hat[aá]rozatlan id') hu,
  count(*) FILTER (WHERE description ~* 'belirsiz s[uü]reli') tr,
  count(*) FILTER (WHERE description ~* 'αορ[ιί]στου') el,
  count(*) FILTER (WHERE description ~* 'durat[aă] nedeterminat') ro,
  count(*) FILTER (WHERE description ~* 'fastans[aæ]ttelse|fast stilling|fast anst[aä]llning|tillsvidareanst') nordique,
  count(*) FILTER (WHERE description ~* '正社員|無期雇用') ja,
  count(*) FILTER (WHERE description ~* '정규직') ko,
  count(*) FILTER (WHERE description ~* '无固定期限|長期合約|正式員工|正职') zh,
  count(*) FILTER (WHERE description ~* 'hợp đồng không xác định|không xác định thời hạn') vi,
  count(*) FILTER (WHERE description ~* 'pekerjaan tetap|jawatan tetap|kontrak tetap') ms,
  count(*) FILTER (WHERE description ~* 'พนักงานประจำ') th,
  count(*) FILTER (WHERE description ~* 'دوام دائم|وظيفة دائمة|عقد دائم') ar
FROM (:servie) servie WHERE "employmentTerm" IS NULL GROUP BY 1 ORDER BY 2 DESC;

-- Q4 « Full-time » seul : un temps de travail sans durée. Combien d'offres sans contrat portent un temps plein ? (jamais un CDI)
SELECT marche, count(*) FILTER (WHERE "employmentTerm" IS NULL AND "workTime" = 'FULL_TIME') temps_plein_sans_duree,
  count(*) FILTER (WHERE "employmentTerm" IS NULL) sans_duree
FROM (:servie) servie GROUP BY 1 ORDER BY 2 DESC;
