import { writeStartupState } from '../observability/logger.js';
/** One pause policy for every operational entry point and collection boundary.
 * A process receives its environment at startup: changing Railway variables must
 * also stop/restart an already running process. There is no command-level bypass. */
export function pipelinePaused(env: NodeJS.ProcessEnv = process.env): boolean {
  const value = env.PIPELINE_PAUSED;
  if (value !== undefined && value !== '0' && value !== '1') throw new Error('PIPELINE_PAUSED must be 0 or 1');
  return value === '1';
}

export class PipelinePausedError extends Error {
  constructor() { super('PIPELINE_PAUSED: no pipeline work may start'); this.name = 'PipelinePausedError'; }
}

export function assertPipelineRunning(): void {
  if (pipelinePaused()) throw new PipelinePausedError();
}

/** Intentional pause is observable and successful, never reported as an ingestion. */
export function exitIfPipelinePaused(command: string): void {
  if (!pipelinePaused()) return;
  writeStartupState('pipeline.paused', { state: 'PAUSED', command, workStarted: false, pid: process.pid });
  process.exit(0);
}
