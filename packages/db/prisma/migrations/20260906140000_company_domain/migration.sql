-- Company.domain : le site officiel de la Maison, lu à une source qui la nomme
-- (domaine carrière du catalogue, ou P856 Wikidata), jamais deviné depuis le
-- nom. Sert le logo (favicon du domaine) ; null => l'initiale, jamais un logo
-- d'une autre entreprise. IF NOT EXISTS : la colonne peut déjà exister après
-- un `db push` local.
ALTER TABLE "Company" ADD COLUMN IF NOT EXISTS "domain" TEXT;
ALTER TABLE "Company" ADD COLUMN IF NOT EXISTS "domainSource" TEXT;
