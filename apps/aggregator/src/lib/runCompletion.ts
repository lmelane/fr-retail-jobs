/** The child acknowledges completion only after PipelineRun is durable. */
export type CompletionStatus = 'COMPLETED' | 'COMPLETED_WITH_ERRORS' | 'FAILED';
export type RunCompletion = { event: 'pipeline.finalized'; runId: string; command: string; status: CompletionStatus };
export function isRunCompletion(value: unknown, command: string, runId?: string): value is RunCompletion {
  if (!value || typeof value !== 'object') return false;
  const v = value as RunCompletion;
  return v.event === 'pipeline.finalized' && v.command === command &&
    typeof v.runId === 'string' && /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(v.runId) &&
    (!runId || v.runId === runId) && ['COMPLETED', 'COMPLETED_WITH_ERRORS', 'FAILED'].includes(v.status);
}
export function workerOutcome(code: number, completion?: RunCompletion, required = true) {
  if (code !== 0 || (required && !completion) || completion?.status === 'FAILED')
    return { exitCode: code || 1, state: 'FAILED' as const };
  return { exitCode: 0, state: completion?.status ?? 'COMPLETED' as CompletionStatus };
}
