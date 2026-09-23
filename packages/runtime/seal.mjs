import { writeFileSync } from 'node:fs';
import { contractSha256 } from './index.mjs';
const gitSha = process.env.CATWALKS_BUILD_SHA || process.env.RAILWAY_GIT_COMMIT_SHA;
if (!/^[a-f0-9]{40}$/.test(gitSha ?? '')) throw new Error('Full source SHA required to build runtime image');
writeFileSync(new URL('./release.json', import.meta.url), JSON.stringify({ gitSha, contractSha256 }) + '\n');
