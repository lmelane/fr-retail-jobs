-- Le schéma MINIMAL du harnais d'épreuve de l'instantané (`audit-corpus-isole.mts`).
--
-- Deux tables seulement, et c'est délibéré : le harnais éprouve une propriété de TRANSACTION
-- (l'isolation `REPEATABLE READ`), pas le schéma applicatif. Y appliquer le schéma complet
-- exigerait `prisma db push`, une commande destructrice dont le garde-fou du projet ne regarde
-- pas la cible — et il a raison : une liste d'interdits qui dépend de la cible finit par être
-- contournée sur la mauvaise.
--
-- Ces deux tables portent exactement le lien à prouver : `CaptureBatch.sourceKey` relie les
-- captures à leur source SANS passer par `JobSource`, ce qui rend visible une source qui a
-- capturé des données mais n'a jamais rien publié.
--
-- À exécuter UNIQUEMENT sur une base jetable.

CREATE TABLE IF NOT EXISTS "Source" (
  id          text PRIMARY KEY,
  key         text NOT NULL UNIQUE,
  kind        text NOT NULL,
  status      text NOT NULL,
  company     text,
  "countryCode" text,
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  "updatedAt" timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS "CaptureBatch" (
  id              text PRIMARY KEY,
  purpose         text NOT NULL DEFAULT 'JOBS',
  "sourceKey"     text NOT NULL,
  "configHash"    text NOT NULL,
  "readerRevision" text NOT NULL,
  "startedAt"     timestamptz NOT NULL DEFAULT now()
);

-- `jobId` nullable, comme en production : une publication peut exister sans offre canonique.
CREATE TABLE IF NOT EXISTS "JobSource" (
  id           text PRIMARY KEY,
  "sourceKey"  text NOT NULL,
  "externalId" text NOT NULL,
  "jobId"      text,
  "isActive"   boolean NOT NULL DEFAULT true,
  "expiresAt"  timestamptz
);
