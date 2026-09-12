import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

/**
 * LA GARDE D'EXÉCUTION — celle qui empêche un `execute` de relancer le pipeline COMPLET en production.
 *
 * Elle a refusé un refresh parfaitement conforme le 2026-09-12 : elle exigeait `INGEST_ONLY_KEYS` dans la
 * commande déployée, alors qu'un refresh porte `REFRESH_ONLY_KEYS` — un refresh ne collecte rien, il ne peut
 * pas porter la variable d'ingestion. La garde n'avait jamais été exercée sur ce chemin.
 *
 * Une garde qui refuse un état conforme finit par être contournée « juste cette fois ». Ces tests fixent donc
 * les DEUX obligations : accepter les deux phases légitimes, et continuer à refuser ce qui est dangereux.
 */
const OPS = resolve(dirname(fileURLToPath(import.meta.url)), '../../scripts/ops');
const KEYS = 'mecca,ganni-talentrecruiter';

/** Exerce la logique RÉELLE de la garde, lue dans le programme, jamais une copie réécrite ici. */
function guard(manifestCommand: string, expectedKeys: string): string {
  const code = `
import re, pathlib, sys
src = pathlib.Path(${JSON.stringify(`${OPS}/railway-service.py`)}).read_text()
m = re.search(r"bounds = \\[v for v in \\((.*?)\\) if f'\\{v\\}=\\{expected_keys\\} ' in \\(manifest or ''\\)\\]", src)
if not m:
    print("MOTIF_INTROUVABLE"); sys.exit(0)
names = [n.strip().strip("'\\"") for n in m.group(1).split(",") if n.strip()]
manifest = sys.argv[1]; expected_keys = sys.argv[2]
bounds = [v for v in names if f"{v}={expected_keys} " in (manifest or "")]
if not bounds: print("REFUS_ALLOWLIST")
elif len(bounds) > 1: print("REFUS_DEUX_BORNES")
else: print("ACCEPTE:" + bounds[0])`;
  return execFileSync('python3', ['-c', code, manifestCommand, expectedKeys], { encoding: 'utf8', cwd: '/' }).trim();
}

describe('garde d\'exécution — périmètre de la commande déployée', () => {
  it('accepte un REFRESH conforme (le cas qu\'elle refusait)', () => {
    expect(guard(`env -u BREVO_API_KEY REFRESH_ONLY_KEYS=${KEYS} node ...`, KEYS)).toBe('ACCEPTE:REFRESH_ONLY_KEYS');
  });

  it('accepte une INGESTION conforme', () => {
    expect(guard(`env -u BREVO_API_KEY INGEST_ONLY_KEYS=${KEYS} node ...`, KEYS)).toBe('ACCEPTE:INGEST_ONLY_KEYS');
  });

  it('refuse un périmètre ÉLARGI en douce', () => {
    expect(guard(`env REFRESH_ONLY_KEYS=${KEYS},urbn-hub node ...`, KEYS)).toBe('REFUS_ALLOWLIST');
  });

  it('refuse un périmètre RÉDUIT', () => {
    expect(guard('env REFRESH_ONLY_KEYS=mecca node ...', KEYS)).toBe('REFUS_ALLOWLIST');
  });

  it('refuse une commande SANS borne — ce serait le pipeline complet en production', () => {
    expect(guard('env node --import tsx -e "runRefresh(p,{})"', KEYS)).toBe('REFUS_ALLOWLIST');
  });

  it('refuse les DEUX bornes à la fois — un état incohérent n\'est pas deux fois sûr', () => {
    expect(guard(`env INGEST_ONLY_KEYS=${KEYS} REFRESH_ONLY_KEYS=${KEYS} node ...`, KEYS)).toBe('REFUS_DEUX_BORNES');
  });
});
