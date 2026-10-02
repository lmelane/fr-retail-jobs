/**
 * D-520 — la lecture simple de l'état des sources (commande `etat-sources`) : le tableau par état, trajectoire et
 * cause, puis chaque source non normale avec ce qui lui manque. Pur. Sans tiret cadratin (D-319).
 */
import { CAUSES, OPERATIONAL_STATES, STATE_LABEL, TRAJECTORIES, TRAJECTORY_LABEL, type CauseClass } from './sourceState.js';
import type { SourceStatesReport } from './sourceStateStore.js';

export function stateReportText(report: SourceStatesReport): string[] {
  const { summary } = report;
  const lines = [`État des sources au ${report.at.slice(0, 16).replace('T', ' ')} UTC : ${summary.total} sources.`];
  if (report.neverComputed) lines.push(`${report.neverComputed} sources actives sans état calculé (aucune collecte depuis la mise en place) : NON_COLLECTEE jusqu'au prochain RUN ou verifier-source.`);
  lines.push('', 'Par état :', ...OPERATIONAL_STATES.map(state => `  ${String(summary.byState[state]).padStart(4)}  ${state.padEnd(11)} ${STATE_LABEL[state]}`));
  lines.push('', 'Par trajectoire :', ...TRAJECTORIES.map(t => `  ${String(summary.byTrajectory[t]).padStart(4)}  ${t.padEnd(13)} ${TRAJECTORY_LABEL[t]}`));
  const causes = (Object.entries(summary.byCause) as Array<[CauseClass, number]>).sort((a, b) => b[1] - a[1]);
  lines.push('', 'Par cause :', ...causes.map(([cause, n]) => `  ${String(n).padStart(4)}  ${cause.padEnd(25)} ${CAUSES[cause].label}`));
  for (const trajectory of TRAJECTORIES) {
    const list = report.sources.filter(s => s.trajectory === trajectory);
    if (!list.length) continue;
    lines.push('', `${TRAJECTORY_LABEL[trajectory]} (${list.length}) :`);
    for (const s of list) {
      const due = s.deadline ? `, échéance ${s.deadline.slice(0, 16).replace('T', ' ')}` : '';
      const decision = s.decision ? `, décision ${s.decision}` : '';
      lines.push(`  ${s.sourceKey} (${s.maison}) : ${s.state}, ${s.cause}, depuis ${s.ageDays} j${due}${decision}`,
        `      manque : ${s.missing ?? ''}${s.codes.length ? ` · codes : ${s.codes.join(', ')}` : ''}`);
    }
  }
  return lines;
}
