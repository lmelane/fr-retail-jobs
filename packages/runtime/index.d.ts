export const target: any;
export const contractSha256: string;
export const release: { gitSha: string; contractSha256: string } | null;
export function workerArguments(argv: string[]): string[];
export function assertBusinessUrl(value: string): void;
export function validateRuntime(role: 'api' | 'worker', argv: string[], env: NodeJS.ProcessEnv,
  built: { gitSha: string; contractSha256: string } | null, now?: number): {
    profile: { name: string; workerPaused: string; optionalDeadlineMaximumSeconds?: number };
    deadline: number | null; proof: Record<string, unknown>;
  };
export function attestRuntime(role: 'api' | 'worker', argv: string[]): ReturnType<typeof validateRuntime> | null;
