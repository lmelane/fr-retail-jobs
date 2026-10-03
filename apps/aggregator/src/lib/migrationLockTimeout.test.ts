/**
 * Release r6 (02/10/2026) : les deux migrations qui verrouillent une grosse table bornent l'ATTENTE de leur verrou.
 * `20261002140000` prend un verrou exclusif sur "JobSource" (ALTER, CHECK, rattrapage) jusqu'au COMMIT ;
 * `20261002210000` construit un index non concurrent sur "EmployerObservation". Sans `lock_timeout`, une lecture longue
 * devant le verrou mettrait en file toute l'API derrière la migration. Témoin statique : la borne précède le premier
 * verrou, dans la même transaction. Preuve d'exécution sur base jetable : `audits/2026-10-02/release-r6/`.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const migration = (name: string) =>
  readFileSync(fileURLToPath(new URL(`../../../../packages/db/prisma/migrations/${name}/migration.sql`, import.meta.url)), 'utf8')
    .split('\n').filter(line => !line.trimStart().startsWith('--')).join('\n');
const position = (sql: string, pattern: RegExp) => sql.search(pattern);

describe('les migrations de r6 bornent l’attente de leur verrou', () => {
  it('20261002140000 : SET LOCAL lock_timeout dans la transaction, avant le premier ALTER de JobSource', () => {
    const sql = migration('20261002140000_r143_disponibilite_autorite');
    const begin = position(sql, /^BEGIN;/m);
    const timeout = position(sql, /^SET LOCAL lock_timeout = '10s';/m);
    const firstLock = position(sql, /ALTER TABLE "JobSource"/);
    expect(begin).toBeGreaterThanOrEqual(0);
    expect(firstLock).toBeGreaterThan(0);
    expect(timeout).toBeGreaterThan(begin);
    expect(timeout).toBeLessThan(firstLock);
  });

  it('20261002210000 : SET lock_timeout avant toute instruction, donc avant l’index non concurrent', () => {
    const sql = migration('20261002210000_file_identite_employeur');
    const timeout = position(sql, /^SET lock_timeout = '10s';/m);
    const index = position(sql, /CREATE INDEX "EmployerObservation_normalizedEmployerName_idx"/);
    const firstStatement = position(sql, /^(CREATE|ALTER|INSERT|UPDATE)\b/m);
    expect(index).toBeGreaterThan(0);
    expect(timeout).toBeGreaterThanOrEqual(0);
    expect(timeout).toBeLessThan(firstStatement);
  });
});

describe('les CHECK de JobSource ne parcourent pas la table sous le verrou exclusif (release r6)', () => {
  it('20261002140000 les pose NOT VALID ; 20261002140100 les valide, borné, sans rien d’autre', () => {
    const add = migration('20261002140000_r143_disponibilite_autorite');
    const checks = add.match(/ADD CONSTRAINT "JobSource_availabilityHold[a-z_]*"[\s\S]*?;/g) ?? [];
    expect(checks).toHaveLength(2);
    for (const check of checks) expect(check).toMatch(/NOT VALID;$/);
    const validate = migration('20261002140100_r143_valider_contraintes');
    expect(validate).toMatch(/^SET lock_timeout = '10s';/m);
    expect(validate.match(/VALIDATE CONSTRAINT "JobSource_availabilityHold(_instant)?_check"/g)).toHaveLength(2);
    expect(validate).not.toMatch(/\b(UPDATE|DELETE|DROP|INSERT)\b/);
  });
});
