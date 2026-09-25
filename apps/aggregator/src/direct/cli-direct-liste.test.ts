import { spawn } from 'node:child_process';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { offreListe } from './fixture.js';
import { ETAT_LISTE } from './photo.js';

/**
 * D-444 — « UNE PANNE DU BACKEND FIGE LA COPIE ET ALERTE », PAR LA VRAIE COMMANDE. Le service `catwalks-direct-sync`
 * lance `tsx src/cli.ts direct-liste` ; l'alerte, c'est son code de sortie et le signal de son check Healthchecks
 * (`/fail`). Ce témoin lance la commande réelle, hors pause, contre un faux backend et un faux Healthchecks locaux :
 * une liste vide et une panne doivent sortir en échec et signaler `/fail` ; une liste complète, réussir et signaler
 * le succès. Base jetable seulement.
 */
const url = process.env.DATABASE_URL ? new URL(process.env.DATABASE_URL) : undefined;
const enabled = !!url && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) && /test/i.test(url.pathname);
const APP = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const P = 'cliD444';

describe.skipIf(!enabled)('la commande direct-liste alerte par son code de sortie et son check (D-444)', () => {
  const prisma = new PrismaClient();
  let serveur: Server;
  let origine = '';
  let reponse: { statut: number; liste: unknown[] } = { statut: 200, liste: [] };
  const signaux: string[] = [];
  const debut = new Date();

  const nettoyer = async () => {
    await prisma.directOffer.deleteMany({ where: { id: { startsWith: P } } });
    await prisma.directFeedCursor.deleteMany({ where: { id: ETAT_LISTE } });
    const runs = (await prisma.pipelineRun.findMany({ where: { command: 'direct-liste', startedAt: { gte: debut } }, select: { id: true } })).map((r) => r.id);
    await prisma.pipelineEvent.deleteMany({ where: { runId: { in: runs } } });
    await prisma.pipelineRun.deleteMany({ where: { id: { in: runs } } });
  };

  /** La vraie commande, hors pause, avec un check Healthchecks local ; rend son code de sortie et les signaux reçus. */
  const lancer = () => new Promise<{ code: number | null; signaux: string[] }>((resolveRun, reject) => {
    signaux.length = 0;
    const env: NodeJS.ProcessEnv = { ...process.env, PIPELINE_PAUSED: '0', CATALOGUE_LISTE_URL: origine, HEALTHCHECK_PING_URL: `${origine}/hc`, PGOPTIONS: '' };
    delete env.CATWALKS_RUNTIME_PROFILE; delete env.RAILWAY_PROJECT_ID;
    const enfant = spawn(process.execPath, ['--import', 'tsx', 'src/cli.ts', 'direct-liste'], { cwd: APP, env, stdio: 'ignore' });
    enfant.once('error', reject);
    enfant.once('exit', (code) => resolveRun({ code, signaux: [...signaux] }));
  });

  beforeAll(async () => {
    await nettoyer();
    serveur = createServer((req, res) => {
      const chemin = req.url ?? '';
      if (chemin.startsWith('/hc')) { signaux.push(chemin); res.writeHead(200).end('OK'); return; }
      if (reponse.statut !== 200) { res.writeHead(reponse.statut).end('panne'); return; }
      const corps = chemin === '/api/jobs' ? reponse.liste
        : chemin === '/api/jobs/filters' ? { contractTypes: [{ value: 'CDI', count: reponse.liste.length }] } : null;
      res.writeHead(corps === null ? 404 : 200, { 'content-type': 'application/json' }).end(JSON.stringify(corps));
    });
    await new Promise<void>((ok) => serveur.listen(0, '127.0.0.1', ok));
    origine = `http://127.0.0.1:${(serveur.address() as AddressInfo).port}`;
  }, 30_000);
  afterAll(async () => {
    await nettoyer();
    await prisma.$disconnect();
    await new Promise<void>((ok) => serveur.close(() => ok()));
  });

  it('une liste vide sort en échec et signale /fail ; rien n’est retiré', async () => {
    await prisma.directOffer.deleteMany({ where: { id: { startsWith: P } } });
    reponse = { statut: 200, liste: [] };
    const r = await lancer();
    expect(r.code).toBe(1);
    expect(r.signaux).toContain('/hc/fail');
    expect(r.signaux).not.toContain('/hc');
  }, 120_000);

  it('une panne du backend sort en échec et signale /fail ; l’état du lecteur garde l’erreur', async () => {
    reponse = { statut: 503, liste: [] };
    const r = await lancer();
    expect(r.code).toBe(1);
    expect(r.signaux).toContain('/hc/fail');
    expect((await prisma.directFeedCursor.findUniqueOrThrow({ where: { id: ETAT_LISTE } })).lastError).toMatch(/503/);
  }, 120_000);

  it('une liste complète réussit, signale le succès et publie l’offre', async () => {
    reponse = { statut: 200, liste: [offreListe({ id: `${P}0001`, slug: 'cli-d444-0001' })] };
    const r = await lancer();
    expect(r.code).toBe(0);
    expect(r.signaux).toContain('/hc');
    expect(r.signaux).not.toContain('/hc/fail');
    expect(await prisma.directOffer.findUniqueOrThrow({ where: { id: `${P}0001` } })).toMatchObject({ eligible: true, countryCode: 'FR' });
  }, 120_000);
});
