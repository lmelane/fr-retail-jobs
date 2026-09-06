-- Treize vendeurs / portails lus par exécution le 2026-09-06 (lots g1–g5 :
-- 26 portails « GENERIC » ou sans adaptateur, ~14 000 offres mesurées).
-- Job.source porte le vrai ATS (D3) : un portail maison prend le nom de la
-- Maison (RITUALS, ASOS, BASH_TALENTS), un vendeur son nom de vendeur.
-- IF NOT EXISTS : la valeur peut déjà exister après un `db push` local.
ALTER TYPE "AtsType" ADD VALUE IF NOT EXISTS 'ORACLE_HCM';
ALTER TYPE "AtsType" ADD VALUE IF NOT EXISTS 'TALEO';
ALTER TYPE "AtsType" ADD VALUE IF NOT EXISTS 'ALTAMIRA';
ALTER TYPE "AtsType" ADD VALUE IF NOT EXISTS 'JOBYLON';
ALTER TYPE "AtsType" ADD VALUE IF NOT EXISTS 'RITUALS';
ALTER TYPE "AtsType" ADD VALUE IF NOT EXISTS 'ASOS';
ALTER TYPE "AtsType" ADD VALUE IF NOT EXISTS 'TALENT_FUNNEL';
ALTER TYPE "AtsType" ADD VALUE IF NOT EXISTS 'BASH_TALENTS';
ALTER TYPE "AtsType" ADD VALUE IF NOT EXISTS 'EQWA';
ALTER TYPE "AtsType" ADD VALUE IF NOT EXISTS 'GEODIRECTORY';
ALTER TYPE "AtsType" ADD VALUE IF NOT EXISTS 'TYPESENSE';
ALTER TYPE "AtsType" ADD VALUE IF NOT EXISTS 'JIBE';
ALTER TYPE "AtsType" ADD VALUE IF NOT EXISTS 'VOLCANIC';
