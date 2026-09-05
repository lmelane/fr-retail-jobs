-- iCIMS rejoint les ATS lisibles (URBN, Aeropostale et les portails
-- {tenant}.icims.com). IF NOT EXISTS : la valeur peut déjà avoir été ajoutée
-- par un `db push` sur un environnement de développement.
ALTER TYPE "AtsType" ADD VALUE IF NOT EXISTS 'ICIMS';
