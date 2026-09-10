import { readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { PrismaClient } from '@prisma/client';
import { applyRepairPlan, digest, type RepairPlan } from './plan.js';
import { planOracleRepair } from './oracle.js';
import { planSmcpRepair } from './smcp.js';
import { planExcludedIdentities } from './identities.js';
import { planReviewedPortalOwners } from './portalOwner.js';
import { planSourceOwners } from './owners.js';
import { planAdministrativeWithdrawals } from './withdrawal.js';

const prisma = new PrismaClient();
const [command, ...args] = process.argv.slice(2);
const arg = (name: string) => { const i = args.indexOf(name); if (i < 0 || !args[i + 1]) throw new Error(`Missing ${name}`); return args[i + 1]; };
try {
  if (command === 'plan-oracle' || command === 'plan-smcp' || command === 'plan-identities' || command === 'plan-homonyms' || command === 'plan-owners' || command === 'plan-portal-owners' || command === 'plan-withdrawals') {
    const plan = command === 'plan-withdrawals' ? await planAdministrativeWithdrawals(prisma, JSON.parse(readFileSync(arg('--spec'), 'utf8'))) : command === 'plan-portal-owners' ? await planReviewedPortalOwners(prisma, JSON.parse(readFileSync(arg('--spec'), 'utf8'))) : command === 'plan-oracle'
      ? await planOracleRepair(prisma, JSON.parse(readFileSync(arg('--evidence'), 'utf8')))
      : command === 'plan-smcp' ? await planSmcpRepair(prisma)
      : command === 'plan-owners' ? await planSourceOwners(prisma)
      : command === 'plan-homonyms' ? await planExcludedIdentities(prisma, JSON.parse(readFileSync(arg('--definitions'), 'utf8')), arg('--batch'))
      : await planExcludedIdentities(prisma);
    writeFileSync(arg('--out'), JSON.stringify(plan, null, 2), { mode: 0o600 });
    console.log(JSON.stringify({ batchId: plan.batchId, hash: digest(plan), operations: plan.operations.length, sourceKeys: plan.sourceKeys, finding: plan.finding }, null, 2));
  } else if (command === 'apply') {
    const plan: RepairPlan = JSON.parse(readFileSync(arg('--plan'), 'utf8'));
    const commit = arg('--commit');
    const host = new URL(process.env.DATABASE_URL!).hostname;
    if (!['localhost', '127.0.0.1', '::1'].includes(host)) {
      const head = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
      if (!/^[a-f0-9]{40}$/.test(commit) || commit !== head) throw new Error('Production repair must run the identified committed checkout');
      execFileSync('git', ['merge-base', '--is-ancestor', commit, 'origin/main']);
      const dirty = execFileSync('git', ['status', '--porcelain', '--untracked-files=all', '--', 'apps/aggregator/src', 'packages/db', 'package.json', 'package-lock.json', 'apps/aggregator/package.json', 'apps/aggregator/data/reference/maisons.csv'], { encoding: 'utf8' }).trim();
      if (dirty) throw new Error('Production repair requires clean committed application code, schema and reference data');
    }
    console.log(JSON.stringify({ batchId: plan.batchId, hash: digest(plan), ...await applyRepairPlan(prisma, plan, arg('--sha'), commit) }, null, 2));
  } else throw new Error('Use plan-oracle or apply with an explicit reviewed plan/hash/commit');
} finally { await prisma.$disconnect(); }
