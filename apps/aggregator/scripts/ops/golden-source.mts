/** Une source neuve dans une base Docker neuve, via les commandes d’onboarding maintenues.
 * Usage via stack:exec : --candidate=/fichier.json --out-dir=/dossier/prive --reviewer=identifiant
 * Aucune base existante n’est effacée ; les captures restent dans un préfixe MinIO dédié. */
import { PrismaClient } from '@prisma/client';
import { spawnSync } from 'node:child_process';
import { mkdirSync, openSync, closeSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { randomBytes } from 'node:crypto';
import { publicJobWhere } from '../../../../packages/db/availability.js';
import { writePrivateFile, readInputJson } from '../../src/lib/privateFile.js';

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
const reviewer = options.get('reviewer')!.trim();
if (!reviewer || reviewer.length > 160 || /[\r\n]/.test(reviewer)) throw new Error('Réviseur explicite requis');
const directory = resolve(options.get('out-dir')!);
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
  const {key,maison,kind,config,careersDomain,tier}=input;
  const candidate=resolve(directory,'register.json');writePrivateFile(candidate,JSON.stringify({key,maison,kind,config,careersDomain,tier})+'\n');
  run('idempotence',['--import','tsx','apps/aggregator/scripts/ops/source-onboard.mts','register',candidate,'--apply',`--out=${registration}`]);
  const again=JSON.parse(readFileSync(registration,'utf8'));
  requireFact(again.created===false && again.sourceRevisionId===source.currentRevisionId && await db.source.count()===1 && await db.job.count()===publicJobs.length,'Réenregistrement non idempotent');
  const proof={verdict:'PASS',database,sourceKey:key,sourceRevisionId:source.currentRevisionId,readerRevision:v.readerRevision,created:true,identity:identity.verdict,access:access.verdict,nativeReplayExact:true,ingestion:v.ingestion,completion:completions[0],publicJobs:publicJobs.length,pays:[...new Set(publicJobs.map(j=>j.countryCode))],captureLinked:true,registrationIdempotent:true,absence:v.absence,reviewer,at:new Date().toISOString()};
  writePrivateFile(resolve(directory,'proof.json'),JSON.stringify(proof,null,2)+'\n');
  console.log(JSON.stringify({verdict:'PASS',database,publicJobs:publicJobs.length,proof:resolve(directory,'proof.json')}));
} finally {await db.$disconnect();}
