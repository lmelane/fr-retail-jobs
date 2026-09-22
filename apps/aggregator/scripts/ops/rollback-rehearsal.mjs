/** Local disposable release rehearsal. Immutable Git archives, actual builds and HTTP servers.
 * stack:exec -- node .../rollback-rehearsal.mjs --before=<sha> --candidate=<sha> --out-dir=<new private directory>
 * Performs a real Oh My Cream collection into its own local DB; never targets an existing DB. */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdirSync, openSync, closeSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes } from 'node:crypto';
import { createServer } from 'node:net';
import { PrismaClient } from '@prisma/client';

const root = fileURLToPath(new URL('../../../../', import.meta.url));
const opts = new Map();
for (const arg of process.argv.slice(2)) {
  const match = /^--(before|candidate|out-dir)=(.+)$/.exec(arg);
  assert(match && !opts.has(match[1]), 'Unique --before, --candidate, --out-dir required');
  opts.set(match[1], match[2]);
}
assert.equal(opts.size, 3);
for (const name of ['before','candidate']) assert.match(opts.get(name), /^[a-f0-9]{40}$/);
const parent = new URL(process.env.DATABASE_URL ?? 'invalid:');
assert(['localhost','127.0.0.1'].includes(parent.hostname) && parent.pathname === '/catwalks_stack_catalogue', 'Local stack parent required');
assert(process.env.PIPELINE_PAUSED === undefined || process.env.PIPELINE_PAUSED === '0', 'Rehearsal requires an unpaused local pipeline (unset or 0); pause is authoritative');
const out = resolve(opts.get('out-dir'));
assert(!existsSync(out), 'Evidence directory must be new');
mkdirSync(out, { recursive:true, mode:0o700 });
const database = `catwalks_rollback_test_${Date.now()}_${randomBytes(3).toString('hex')}`;
const url = new URL(parent); url.pathname = `/${database}`;
const env = { ...process.env, DATABASE_URL:url.href, DIRECT_URL:url.href, PIPELINE_PAUSED:'0', NEXT_TELEMETRY_DISABLED:'1',
  CATALOGUE_API_KEY:randomBytes(24).toString('hex'), OBSERVATION_ARCHIVE_S3_PREFIX:`rollback/${database}` };
for (const name of Object.keys(env)) if (/^RAILWAY_|BREVO|HEALTHCHECK|GOOGLE_INDEXING|DIRECT_FEED|CATALOGUE_FLUX/.test(name)) delete env[name];
// The canary needs only hot RAW. This rehearsal deliberately has no object storage configured.
for (const name of Object.keys(env)) if (name.startsWith('OBSERVATION_ARCHIVE_S3_')) delete env[name];
let sequence = 0;
async function command(cwd, executable, args, overrides={}) {
  const step=++sequence;
  const fd = openSync(join(out, `${step}-${executable.split('/').at(-1)}.log`), 'wx', 0o600);
  const child=spawn(executable,args,{cwd,env:{...env,...overrides},stdio:['ignore',fd,fd],detached:true});
  closeSync(fd);
  const timer=setTimeout(()=>{try{process.kill(-child.pid,'SIGKILL');}catch{child.kill('SIGKILL');}},20*60_000);
  try {
    await new Promise((resolve,reject)=>{
      child.once('error',reject);
      child.once('close',code=>code===0?resolve():reject(new Error(`Step ${step} failed; inspect private log`)));
    });
  } finally {clearTimeout(timer);}
}
const versions={};
for (const name of ['before','candidate']) {
  const dir=join(out,name); mkdirSync(dir,{mode:0o700});
  const tar=join(out,`${name}.tar`);
  await command(root,'git',['archive','--format=tar',`--output=${tar}`,opts.get(name)]);
  await command(root,'tar',['-xf',tar,'-C',dir]); rmSync(tar);
  await command(dir,'npm',['ci','--workspaces','--include-workspace-root'],{NODE_ENV:'development'});
  await command(dir,process.execPath,['node_modules/prisma/build/index.js','generate','--schema','packages/db/prisma/schema.prisma']);
  await command(dir,'npm',['run','build','-w','@catwalks/api'],{NODE_ENV:'production'});
  versions[name]=dir;
  console.log(JSON.stringify({step:'archive-installed-built',name,sha:opts.get(name)}));
}
const admin=new PrismaClient({datasources:{db:{url:parent.href}},log:[]});
try { await admin.$executeRawUnsafe(`CREATE DATABASE "${database}"`); } finally {await admin.$disconnect();}
const db=new PrismaClient({datasources:{db:{url:url.href}},log:[]});
const proof={before:opts.get('before'),candidate:opts.get('candidate'),database,steps:[],policy:'code rollback; keep forward-compatible DB',directOffers:'hors canari',objectStorage:'absent; hot RAW PostgreSQL'};
const save=()=>writeFileSync(join(out,'proof.json'),JSON.stringify(proof,null,2)+'\n',{mode:0o600});
const migrate = name => command(versions[name],process.execPath,['node_modules/prisma/build/index.js','migrate','deploy','--schema','packages/db/prisma/schema.prisma']);
async function snapshot() {
  const migrations=await db.$queryRaw`SELECT migration_name,checksum,finished_at FROM "_prisma_migrations" WHERE rolled_back_at IS NULL ORDER BY migration_name`;
  assert(migrations.every(m=>m.finished_at));
  const sources=await db.source.findMany({orderBy:{key:'asc'},select:{key:true,status:true,config:true,currentRevisionId:true}});
  const jobs=await db.job.findMany({orderBy:{id:'asc'},select:{id:true,countryCode:true,isActive:true}});
  return {migrations,sources,jobs,raw:await db.rawCapture.count(),completions:await db.sourceIngestionCompletion.count(),directOffers:await db.directOffer.count()};
}
async function http(name) {
  const socket=createServer(); await new Promise(r=>socket.listen(0,'127.0.0.1',r));
  const port=socket.address().port; await new Promise(r=>socket.close(r));
  const fd=openSync(join(out,`${++sequence}-server-${name}.log`),'wx',0o600);
  const child=spawn(process.execPath,['node_modules/next/dist/bin/next','start','apps/api','--hostname','127.0.0.1','--port',String(port)],{cwd:versions[name],env:{...env,NODE_ENV:'production'},stdio:['ignore',fd,fd]});
  closeSync(fd);
  const closed=new Promise(r=>{child.once('error',r);child.once('close',r);});
  try {
    let health;
    for(let n=0;n<100;n++) {
      assert.equal(child.exitCode,null,'API exited before readiness');
      try {health=await fetch(`http://127.0.0.1:${port}/api/health`,{signal:AbortSignal.timeout(2000)});if(health.ok)break;}catch{}
      await new Promise(r=>setTimeout(r,200));
    }
    assert.equal(health?.status,200,'Actual API readiness must pass');
    const jobs=await fetch(`http://127.0.0.1:${port}/api/jobs?marche=FR`,{headers:{authorization:`Bearer ${env.CATALOGUE_API_KEY}`},signal:AbortSignal.timeout(5000)});
    assert.equal(jobs.status,200,'Authenticated API must answer');
    const pages=[await jobs.json()];
    const seen=new Set();
    while(pages.at(-1).suivant) {
      const cursor=pages.at(-1).suivant;assert(!seen.has(cursor),'Repeated pagination cursor');seen.add(cursor);
      const page=await fetch(`http://127.0.0.1:${port}/api/jobs?marche=FR&apres=${encodeURIComponent(cursor)}`,{headers:{authorization:`Bearer ${env.CATALOGUE_API_KEY}`},signal:AbortSignal.timeout(5000)});
      assert.equal(page.status,200);pages.push(await page.json());assert(pages.length<1000);
    }
    const body=pages[0], rows=pages.flatMap(p=>p.jobs).sort((a,b)=>a.id.localeCompare(b.id));
    assert.equal(rows.length,body.total);
    let detail=null;
    if(rows.length) {
      const response=await fetch(`http://127.0.0.1:${port}/api/offres/${encodeURIComponent(rows[0].id)}`,{headers:{authorization:`Bearer ${env.CATALOGUE_API_KEY}`},signal:AbortSignal.timeout(5000)});
      assert.equal(response.status,200);detail=await response.json();
    }
    return {health:200,status:jobs.status,total:body.total,jobs:rows,detail};
  } finally {
    child.kill('SIGTERM');
    const force=setTimeout(()=>child.kill('SIGKILL'),5000);
    try{await closed;}finally{clearTimeout(force);}
  }
}
try {
  await migrate('before');
  // Test fixture uses the actual registry function: no direct SQL/status edit.
  await command(versions.before,process.execPath,['--import','tsx','--input-type=module','--eval',`
    import {PrismaClient} from '@prisma/client';
    import {registerSourceCandidate} from './apps/aggregator/src/connectors/sourceCandidate.ts';
    const db=new PrismaClient();try {await registerSourceCandidate(db,{key:'douglas-sf',maison:'Douglas',kind:'successfactors',config:{origin:'https://jobs.douglas.group'},careersDomain:'jobs.douglas.group',tier:'GROUP_OFFICIAL'});}finally{await db.$disconnect();}
  `]);
  const before=await snapshot(); assert.equal(before.sources[0].config.brandProperty,undefined);
  proof.steps.push({step:'before',database:before,http:await http('before')});save();
  await migrate('candidate');
  const migrated=await snapshot();
  assert.equal(migrated.sources[0].config.brandProperty,'sfstd_marketingBrand_obj');
  assert.notEqual(migrated.sources[0].currentRevisionId,before.sources[0].currentRevisionId);
  assert.equal(migrated.migrations.length,before.migrations.length+1);
  assert.deepEqual(migrated.migrations.filter(m=>m.migration_name!=='20260922100000_douglas_brand_property'),before.migrations);
  proof.steps.push({step:'candidate-migrated',database:migrated,http:await http('candidate')});save();
  await command(versions.candidate,'sh',['apps/aggregator/start.sh','source-add','--key=oh-my-cream','--name=Oh My Cream','--kind=teamtailor',
    '--careers-url=https://careers.ohmycream.com','--official-domain=ohmycream.com','--tier=EMPLOYER_DIRECT',
    '--reviewer=pr1-local-rollback','--setting=origin=https://careers.ohmycream.com',`--out-dir=${out}/source-add`]);
  const populated=await snapshot(); assert(populated.jobs.length>0 && populated.raw>0 && populated.completions===1);
  assert.equal(populated.directOffers,0);
  const candidateHttp=await http('candidate');assert(candidateHttp.total>0);
  proof.steps.push({step:'candidate-populated',database:populated,http:candidateHttp});save();
  // A rollback remains PAUSED. It neither downgrades the DB nor recollects under an older reader.
  await command(versions.candidate,'sh',['apps/aggregator/start.sh'],{PIPELINE_PAUSED:'1'});
  await command(versions.before,'sh',['apps/aggregator/start.sh'],{PIPELINE_PAUSED:'1'});
  const rolledBack=await http('before');assert.deepEqual(rolledBack,candidateHttp);
  assert.deepEqual(await snapshot(),populated);
  proof.steps.push({step:'application-rollback',http:rolledBack,databaseUnchanged:true,workerPaused:true});
  proof.verdict='PASS';save();
  console.log(JSON.stringify({verdict:'PASS',database,proof:join(out,'proof.json')}));
} catch(error) {proof.verdict='FAIL';proof.error=error.message;save();throw error;}
finally {await db.$disconnect();}
