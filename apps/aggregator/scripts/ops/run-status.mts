/**
 * Le statut d'un `PipelineRun` nommé — lecture seule, pour savoir quand un run borné est TERMINÉ.
 *
 * Pourquoi c'est ce statut et pas l'absence de logs : une restauration de commande redéploie le service et
 * TUERAIT un run encore en vol. On n'attend donc pas « plus rien ne bouge », on attend un statut terminal
 * écrit par le run lui-même.
 *
 * usage: run-status.mts --command=<nom du run>
 */
import { PrismaClient } from '@prisma/client';

const arg = (n: string) => process.argv.find((a) => a.startsWith(`--${n}=`))?.slice(n.length + 3);
const command = arg('command');
if (!command) { console.error('usage: run-status.mts --command=<nom>'); process.exit(2); }

const p = new PrismaClient();
try {
  const run = await p.pipelineRun.findFirst({
    where: { command }, orderBy: { startedAt: 'desc' },
    select: { id: true, status: true, startedAt: true, finishedAt: true, revision: true },
  });
  console.log(JSON.stringify(run ?? { status: 'ABSENT' }));
} finally {
  await p.$disconnect();
}
