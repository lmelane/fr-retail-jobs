-- La prod (créée à l'ère `db push`) est ANTÉRIEURE à la migration init :
-- la baseline `migrate resolve --applied 20260903000000_init` affirme que
-- Job.language existe alors qu'il manque — attrapé par la répétition D26 sur
-- le dump restauré (separate-fused crashait sur ce SELECT). Écart mesuré par
-- `prisma migrate diff` prod↔init : cette seule colonne. IF NOT EXISTS rend
-- le rattrapage sûr sur toute base où init a déjà créé la colonne.
ALTER TABLE "Job" ADD COLUMN IF NOT EXISTS "language" TEXT;
