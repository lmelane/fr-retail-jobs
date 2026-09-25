export const target: any;
export const contractSha256: string;
export const release: { gitSha: string; contractSha256: string } | null;
export const SERVICE_OF_ROLE: Record<'api' | 'worker' | 'direct-sync', string>;
export const DIRECT_SYNC_COMMAND: 'direct-liste';
export function directSyncArguments(argv: string[]): string[];
export function workerArguments(argv: string[]): string[];
export function scheduledRunDue(now?: Date): boolean;
export function assertBusinessUrl(value: string): void;
export function validateRuntime(role: 'api' | 'worker' | 'direct-sync', argv: string[], env: NodeJS.ProcessEnv,
  built: { gitSha: string; contractSha256: string } | null, now?: number): {
    profile: { name: string; workerPaused: string; optionalDeadlineMaximumSeconds?: number };
    deadline: number | null; proof: Record<string, unknown>;
  };
export function attestRuntime(role: 'api' | 'worker' | 'direct-sync', argv: string[]): ReturnType<typeof validateRuntime> | null;
