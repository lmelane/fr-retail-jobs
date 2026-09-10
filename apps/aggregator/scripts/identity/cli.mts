import { PrismaClient } from '@prisma/client';
import { readFileSync, writeFileSync } from 'node:fs';
import { buildEmployerRepair, applyEmployerRepair, type EmployerRepairSpec, type EmployerRepairPlan } from '../../src/identity/repair.js';
import { digest } from '../../src/remediation/plan.js';
const [mode, input, outputOrHash, commitHash] = process.argv.slice(2);
if (!['plan', 'apply'].includes(mode) || !input || !outputOrHash) throw new Error('Usage: identity/cli.mts plan spec.json plan.json | apply plan.json expected-sha256 deployed-commit');
const prisma = new PrismaClient();
try {
  if (mode === 'plan') {
    const plan = await buildEmployerRepair(prisma, JSON.parse(readFileSync(input, 'utf8')) as EmployerRepairSpec);
    writeFileSync(outputOrHash, JSON.stringify(plan, null, 2) + '\n');
    console.log(JSON.stringify({ hash: digest(plan), companies: plan.companyIds.length, jobs: plan.jobCount, activeJobs: plan.activeJobCount, sources: plan.sourceCount, merges: plan.merges.length, aliases: plan.aliases.length }));
  } else {
    if (!commitHash) throw new Error('A deployed commit hash is required');
    console.log(JSON.stringify(await applyEmployerRepair(prisma, JSON.parse(readFileSync(input, 'utf8')) as EmployerRepairPlan, outputOrHash, commitHash)));
  }
} finally { await prisma.$disconnect(); }
