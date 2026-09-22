/** Une source neuve dans une base Docker neuve, via les commandes d’onboarding maintenues.
 * Usage via stack:exec : --candidate=/fichier.json --out-dir=/dossier/prive --reviewer=identifiant
 * Aucune base existante n’est effacée ; les captures restent dans un préfixe MinIO dédié. */
import { PrismaClient } from '@prisma/client';
import { spawnSync } from 'node:child_process';
import { mkdirSync, openSync, closeSync, readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { randomBytes } from 'node:crypto';
import { publicJobWhere } from '../../../../packages/db/availability.js';
import { writePrivateFile, readInputJson } from '../../src/lib/privateFile.js';
import { parseSourceCandidate } from '../../src/connectors/sourceCandidate.js';

const root = fileURLToPath(new URL('../../../../', import.meta.url));
const options = new Map<string, string>();
for (const arg of process.argv.slice(2)) {
  const m = /^--(candidate|out-dir|reviewer)=(.+)$/.exec(arg);
  if (!m || options.has(m[1])) throw new Error('Options : --candidate= --out-dir= --reviewer=, uniques et obligatoires');
  options.set(m[1], m[2]);
}
if (options.size !== 3) throw new Error('Options : --candidate= --out-dir= --reviewer=');
const sourceUrl = new URL(process.env.DATABASE_URL ?? 'invalid:');
const storeUrl = new URL(process.env.OBSERVATION_ARCHIVE_S3_ENDPOINT ?? 'invalid:');
if (!['localhost','127.0.0.1'].includes(sourceUrl.hostname) || sourceUrl.pathname !== '/catwalks_stack_catalogue'
  || !['localhost','127.0.0.1'].includes(storeUrl.hostname)) throw new Error('Golden Path exige stack:exec avec PostgreSQL et MinIO locaux');
const input = readInputJson(resolve(options.get('candidate')!), 128_000) as Record<string, unknown>;
if (!input || Array.isArray(input) || typeof input.key !== 'string' || !/^[a-z0-9-]+$/.test(input.key)) throw new Error('Un candidat unique avec une clé explicite est requis');
const {key,maison,kind,config,careersDomain,tier,jobUrlPattern}=input;
const registrationInput=parseSourceCandidate({key,maison,kind,config,careersDomain,tier,...(jobUrlPattern == null ? {} : {jobUrlPattern})});
const reviewer = options.get('reviewer')!.trim();
if (!reviewer || reviewer.length > 160 || /[\r\n]/.test(reviewer)) throw new Error('Réviseur explicite requis');
const directory = resolve(options.get('out-dir')!);
if (existsSync(directory)) throw new Error('Le dossier de preuve doit être nouveau ; aucun rejeu ne doit écraser une preuve précédente');
mkdirSync(directory, { recursive: true, mode: 0o700 });
const database = `catwalks_golden_source_test_${Date.now()}_${randomBytes(3).toString('hex')}`;
const url = new URL(sourceUrl); url.pathname = `/${database}`;
const env = { ...process.env, DATABASE_URL: url.href, DIRECT_URL: url.href, OBSERVATION_ARCHIVE_S3_PREFIX: `golden-source/${database}` };
const admin = new PrismaClient({ datasources: {db: {url: sourceUrl.href}}, errorFormat:'minimal',log:[] });
try {
  const [identity] = await admin.$queryRaw<{base:string}[]>`SELECT current_database() AS base`;
  if (identity.base !== 'catwalks_stack_catalogue') throw new Error('Base administrative inattendue');
  // Identifiant généré par le programme, jamais une chaîne libre reçue en argument.
  await admin.$executeRawUnsafe(`CREATE DATABASE "${database}"`);
} finally { await admin.$disconnect(); }
console.log(JSON.stringify({etape:'base_neuve',database,directory}));
writePrivateFile(resolve(directory,'environment.json'),JSON.stringify({database,host:url.hostname,port:url.port,archivePrefix:env.OBSERVATION_ARCHIVE_S3_PREFIX})+'\n');
function run(name:string, args:string[]) {
  const fd = openSync(resolve(directory,`${name}.log`),'wx',0o600);
  try {
    const r=spawnSync(process.execPath,args,{cwd:root,env,stdio:['ignore',fd,fd]});
    if (r.status !== 0) throw new Error(`${name} a échoué ; consulter son journal privé`);
  } finally { closeSync(fd); }
  console.log(JSON.stringify({etape:name,statut:'OK'}));
}
run('migrations',['node_modules/prisma/build/index.js','migrate','deploy','--schema','packages/db/prisma/schema.prisma']);
const db=new PrismaClient({datasources:{db:{url:url.href}},errorFormat:'minimal',log:[]});
function requireFact(fact:unknown,message:string):asserts fact {if(!fact)throw new Error(message);}
try {
  requireFact(await db.source.count()===0 && await db.job.count()===0,'La base de départ doit être vide');
  const candidates=resolve(directory,'candidate.json');writePrivateFile(candidates,JSON.stringify([input],null,2)+'\n');
  run('qualification',['--import','tsx','apps/aggregator/scripts/ops/source-campaign.mts',`--candidates=${candidates}`,`--out-dir=${directory}/campaign`,`--keys=${input.key}`,'--limit=1','--deadline-ms=120000',`--reviewer=${reviewer}`,'--ingest']);
  const verdicts=JSON.parse(readFileSync(resolve(directory,'campaign/verdicts.json'),'utf8'));
  const v=verdicts[0];
  requireFact(verdicts.length===1 && v?.verdict==='QUALIFIEE','La source n’est pas qualifiée : lire le verdict privé');
  requireFact(v.etapes.enregistrement.created===true,'La source doit réellement être créée');
  requireFact(v.ingestion?.exit===0 && v.ingestion.ok===true && v.ingestion.errors===0,'L’ingestion doit finir sans erreur');
  requireFact(v.capacites?.publication==='OK','Qualification sans publication effective');
  const source=await db.source.findUniqueOrThrow({where:{key:input.key}});
  requireFact(source.status==='ACTIVE','Source non active');
  const identity=await db.sourceIdentityReview.findFirst({where:{sourceRevisionId:source.currentRevisionId!},orderBy:{sequence:'desc'}});
  requireFact(identity?.verdict==='VERIFIED','Golden Path exige une identité prouvée même si la promotion générale la rend facultative');
  const access=await db.sourceAccessDecision.findFirst({where:{sourceRevisionId:source.currentRevisionId!},orderBy:{sequence:'desc'}});
  requireFact(access?.verdict==='ALLOWED','Décision d’accès absente');
  const validations=await db.sourceValidation.findMany({where:{sourceRevisionId:source.currentRevisionId!},orderBy:{sequence:'desc'}});
  requireFact(validations.length>0 && validations.every(x=>x.verdict==='VALIDATED' && (x.report as Record<string,unknown>).replayExact===true),'Rejeu natif non prouvé');
  const completions=await db.sourceIngestionCompletion.findMany();
  requireFact(completions.length===1 && completions[0].published>0 && completions[0].writeFailed===0 && completions[0].held===0,'Fin d’ingestion non attestée ou partielle');
  requireFact(await db.sourceIngestionAdmission.count()===1,'Admission manquante');
  const publicJobs=await db.job.findMany({where:publicJobWhere(),select:{id:true,countryCode:true}});
  requireFact(publicJobs.length===completions[0].published && publicJobs.length>0,'Le nombre d’offres publiables diffère des publications attestées');
  const sources=await db.jobSource.findMany({where:{sourceKey:input.key},select:{captureBatchId:true,captureOutputId:true}});
  requireFact(sources.length===publicJobs.length && sources.every(s=>s.captureBatchId===completions[0].batchId && s.captureOutputId),'Publication sans capture ni sortie liée');
  // Le rejeu relit les archives scellées, sans retourner sur le site source.
  run('rejeu',['--import','tsx','apps/aggregator/scripts/ops/source-onboard.mts','validate',completions[0].batchId,'--apply']);
  // Réenregistrer le même candidat ne doit créer ni source, ni révision, ni offre supplémentaire.
  const registration=resolve(directory,'registration.json');
  const candidate=resolve(directory,'register.json');writePrivateFile(candidate,JSON.stringify(registrationInput)+'\n');
  run('idempotence',['--import','tsx','apps/aggregator/scripts/ops/source-onboard.mts','register',candidate,'--apply',`--out=${registration}`]);
  const again=JSON.parse(readFileSync(registration,'utf8'));
  requireFact(again.created===false && again.sourceRevisionId===source.currentRevisionId && await db.source.count()===1 && await db.job.count()===publicJobs.length,'Réenregistrement non idempotent');
  run('seconde-ingestion',['--import','tsx','apps/aggregator/src/cli.ts','ingest',`--source=${key}`,'--no-geocode']);
  const result=readFileSync(resolve(directory,'seconde-ingestion.log'),'utf8').split('\n').flatMap(line=>{try {const x=JSON.parse(line);return x.event==='command.result'?[x.data]:[];}catch{return [];}}).at(-1);
  const second=result?.sources?.[0];
  requireFact(result?.ok===true && result.sources.length===1 && second.created===0 && second.updated===publicJobs.length && second.errors===0,'Seconde ingestion non idempotente : examiner le journal et une éventuelle évolution réelle du portail');
  const after=await db.job.findMany({where:publicJobWhere(),select:{id:true}});
  requireFact(JSON.stringify(after.map(j=>j.id).sort())===JSON.stringify(publicJobs.map(j=>j.id).sort()) && await db.job.count()===publicJobs.length,'Le corpus ou les identifiants ont changé');
  const finalCompletions=await db.sourceIngestionCompletion.findMany({orderBy:{completedAt:'asc'}});
  requireFact(finalCompletions.length===2 && await db.sourceIngestionAdmission.count()===2 && finalCompletions.every(c=>c.published===publicJobs.length && c.held===0 && c.writeFailed===0 && c.skipped===0),'Les deux ingestions doivent être entièrement attestées');
  for (const completion of finalCompletions) {
    const outcome=await db.captureOutcome.findUniqueOrThrow({where:{batchId:completion.batchId}});
    requireFact(outcome.status==='EXTRACTED' && outcome.extractedCount===completion.published && outcome.manifestHash,'Chaque sortie scellée doit avoir été publiée');
  }
  const latest=finalCompletions[1];
  requireFact(await db.jobSource.count({where:{sourceKey:input.key,captureBatchId:latest.batchId,captureOutputId:{not:null}}})===publicJobs.length,'La seconde ingestion doit relier chaque publication à sa nouvelle capture');
  run('second-rejeu',['--import','tsx','apps/aggregator/scripts/ops/source-onboard.mts','validate',latest.batchId,'--apply']);
  // Processus neuf : le client partagé de l’API et le stockage lisent uniquement cet environnement local.
  run('lecture-api',['--import','tsx','--input-type=module','--eval',`
    import assert from 'node:assert/strict';
    import {prisma} from './packages/db/index.ts';
    import {getJobs,parseFilters} from './apps/api/lib/jobs.ts';
    import {publicJobWhere} from './packages/db/availability.ts';
    import {readRefreshPlan} from './apps/aggregator/src/pipeline/refresh.ts';
    import {writePrivateFile} from './apps/aggregator/src/lib/privateFile.ts';
    const [sourceKey,out]=process.argv.slice(1);
    try {
      const rows=await prisma.job.findMany({where:publicJobWhere(),select:{id:true,countryCode:true}});
      const markets=[];
      for(const market of [...new Set(rows.flatMap(r=>r.countryCode?[r.countryCode]:[]))]) {
        const expected=rows.filter(r=>r.countryCode===market).map(r=>r.id).sort();
        const ids=[];let apres;
        do { const page=await getJobs(parseFilters({marche:market,apres}));assert.equal(page.total,expected.length);ids.push(...page.jobs.map(j=>j.id));apres=page.suivant??undefined;assert(ids.length<=expected.length); } while(apres);
        assert.deepEqual(ids.sort(),expected);markets.push({market,total:ids.length});
      }
      const plan=await readRefreshPlan(prisma,{onlyKeys:[sourceKey]});
      assert.equal(plan.wouldClose.length,0);
      const e=plan.absencePlan.eligibility.find(x=>x.source===sourceKey);
      writePrivateFile(out,JSON.stringify({markets,unknownCountry:rows.filter(r=>r.countryCode===null).length,absence:{eligible:e?.eligible??false,reasons:e?.reasons??[],termination:e?.termination??null,representations:Object.fromEntries([...plan.absencePlan.states.values()].reduce((m,s)=>m.set(s,(m.get(s)??0)+1),new Map()))},wouldClose:plan.wouldClose.length},null,2)+'\\n');
    } finally {await prisma.$disconnect();}
  `,String(key),resolve(directory,'readback.json')]);
  const readback=JSON.parse(readFileSync(resolve(directory,'readback.json'),'utf8'));
  const proof={verdict:'PASS',database,sourceKey:key,sourceRevisionId:source.currentRevisionId,readerRevision:v.readerRevision,created:true,identity:identity.verdict,access:access.verdict,nativeReplayExact:true,ingestion:v.ingestion,secondIngestion:second,completions:finalCompletions,publicJobs:publicJobs.length,pays:[...new Set(publicJobs.map(j=>j.countryCode))],captureLinked:true,registrationIdempotent:true,ingestionIdempotent:true,firstAbsence:v.absence,readback,reviewer,at:new Date().toISOString()};
  writePrivateFile(resolve(directory,'proof.json'),JSON.stringify(proof,null,2)+'\n');
  console.log(JSON.stringify({verdict:'PASS',database,publicJobs:publicJobs.length,proof:resolve(directory,'proof.json')}));
} finally {await db.$disconnect();}
