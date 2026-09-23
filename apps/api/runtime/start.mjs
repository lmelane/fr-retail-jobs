import { attestRuntime } from '../../../packages/runtime/index.mjs';
const result = attestRuntime('api', process.argv.slice(2));
if (!result) throw new Error('API image requires embedded runtime release');
const { gitSha, contractSha256, role, profile } = result.proof;
process.env.CATWALKS_RUNTIME_ATTESTATION = JSON.stringify({ gitSha, contractSha256, role, profile });
await import('../server.js');
