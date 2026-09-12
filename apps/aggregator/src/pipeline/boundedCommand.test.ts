import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

/**
 * Le chemin est résolu depuis CE FICHIER, jamais depuis le répertoire courant.
 *
 * `test:unit` s'exécute depuis la racine du dépôt et `test:integration` depuis `apps/aggregator` : un chemin
 * relatif au cwd fonctionne dans l'un et se dédouble dans l'autre (`apps/aggregator/apps/aggregator/…`). La CI
 * l'a vu, ma vérification locale non — je n'avais lancé vitest que depuis la racine.
 */
const SCRIPT = resolve(dirname(fileURLToPath(import.meta.url)), '../../scripts/ops/bounded-command.py');

/**
 * LA COMMANDE BORNÉE — ce qui la rend sûre doit être vérifié, pas relu.
 *
 * Elle est posée comme commande de démarrage d'un service de PRODUCTION. Une commande mal formée qui se
 * déploie quand même remplace la commande normale par quelque chose qui échoue : le service reste alors dans
 * un état borné inutilisable. Et une commande qui oublierait son allowlist lancerait les 440 sources.
 */
const build = (runName: string, keys: string) =>
  execFileSync('python3', [SCRIPT, runName, keys], { encoding: 'utf8' });

describe('bounded-command — la commande de démarrage d\'une ingestion bornée', () => {
  const keys = 'mecca,beiersdorf';
  const cmd = build('p7-test', keys);

  it('porte l\'allowlist EXACTE, visible dans le manifeste du déploiement', () => {
    // La garde d'exécution cherche littéralement `INGEST_ONLY_KEYS=<clés> ` : sans l'espace final, une
    // allowlist plus longue commençant par les mêmes clés passerait la garde.
    expect(cmd).toContain(`INGEST_ONLY_KEYS=${keys} `);
  });

  it('retire les canaux d\'alerte de l\'exécution : ils sont testés au préflight, pas émis par un run partiel', () => {
    expect(cmd).toContain('-u BREVO_API_KEY');
    expect(cmd).toContain('-u HEALTHCHECK_PING_URL');
    expect(cmd).toContain('-u GOOGLE_INDEXING_CREDENTIALS');
  });

  it('appelle l\'orchestrateur d\'INGESTION, et rien d\'autre — ni refresh, ni snapshot, ni reconcile', () => {
    expect(cmd).toContain('ingestAllBySource');
    expect(cmd).not.toContain('runRefresh');
    expect(cmd).not.toContain('runSnapshot');
    expect(cmd).not.toContain('runReconcile');
  });

  it('ferme toujours son PipelineRun, y compris en erreur — sinon la garde de déploiement le croit en vol', () => {
    // Le succès distingue COMPLETED de COMPLETED_WITH_ERRORS selon le résultat ; l'échec est inconditionnel.
    expect(cmd).toContain('"COMPLETED_WITH_ERRORS":"COMPLETED"');
    expect(cmd).toContain('run.finish("FAILED")');
    expect(cmd).toContain('catch(error)');
  });

  it('n\'est jamais la commande normale : la garde d\'exécution refuserait de lancer', () => {
    expect(cmd).not.toBe('sh apps/aggregator/start.sh');
    expect(cmd.startsWith('env -u ')).toBe(true);
  });

  it('le JavaScript est échappé en UN seul argument shell, guillemets et $ compris', () => {
    // `$disconnect` et les guillemets doubles survivent : assemblée à la main en shell, la commande se cassait.
    expect(cmd).toContain('$disconnect');
    expect(cmd).toContain('startObservability');
    const quoted = cmd.slice(cmd.indexOf(" -e '") + 4);
    expect(quoted.startsWith("'")).toBe(true);
    expect(quoted.trimEnd().endsWith("'")).toBe(true);
  });

  it('le nom du run est repris tel quel, pour que l\'attente lise le bon PipelineRun', () => {
    expect(build('p7-bounded-ingest-20260912T100000Z', keys)).toContain('"p7-bounded-ingest-20260912T100000Z"');
  });
});

/**
 * LA COMMANDE DE REFRESH BORNÉ — elle porte le manifeste, donc la mutation n'a rien à recalculer.
 */
const REFRESH_SCRIPT = resolve(dirname(fileURLToPath(import.meta.url)), '../../scripts/ops/bounded-refresh-command.py');

describe('bounded-refresh-command — le refresh consomme le manifeste', () => {
  const manifestFile = resolve('/tmp', `p7-manifest-${process.pid}.json`);
  writeFileSync(manifestFile, JSON.stringify({ entries: [{ jobSourceId: 'JS1' }, { jobSourceId: 'JS2' }] }));
  const cmd = execFileSync('python3', [REFRESH_SCRIPT, 'p7-test', 'mecca,beiersdorf', manifestFile],
    { encoding: 'utf8' });

  it('porte REFRESH_ONLY_KEYS exactement, et JAMAIS INGEST_ONLY_KEYS', () => {
    expect(cmd).toContain('REFRESH_ONLY_KEYS=mecca,beiersdorf ');
    expect(cmd).not.toContain('INGEST_ONLY_KEYS');
  });

  it('embarque la liste EXACTE des JobSource à désactiver', () => {
    expect(/const manifest=\["JS1", ?"JS2"\];/.test(cmd)).toBe(true);
  });

  it('appelle runRefresh et RIEN d\'autre — ni ingestion, ni snapshot, ni geocode', () => {
    expect(cmd).toContain('runRefresh');
    expect(cmd).not.toContain('ingestAllBySource');
    expect(cmd).not.toContain('runSnapshot');
    expect(cmd).not.toContain('runGeocode');
  });

  it('ferme toujours son PipelineRun, y compris en erreur', () => {
    expect(cmd).toContain('run.finish("FAILED")');
    expect(cmd).toContain('catch(error)');
  });

  it('retire les canaux d\'alerte de l\'exécution', () => {
    expect(cmd).toContain('-u BREVO_API_KEY');
    expect(cmd).toContain('-u HEALTHCHECK_PING_URL');
  });
});
