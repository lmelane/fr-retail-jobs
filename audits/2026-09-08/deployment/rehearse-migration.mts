import { PrismaClient } from '@prisma/client';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
const url = new URL(process.env.DATABASE_URL!);
if (url.hostname !== '127.0.0.1' || url.pathname !== '/catwalks_prod_rehearsal_online') throw new Error('Only the dedicated local production copy is permitted');
const prisma = new PrismaClient();
const start = Date.now();
const child = spawn('node', ['node_modules/prisma/build/index.js','migrate','deploy','--schema','packages/db/prisma/schema.prisma'], { env: process.env });
let output = ''; let finished = false;
child.stdout.on('data', x => { output += x; }); child.stderr.on('data', x => { output += x; });
const done = new Promise<number|null>(resolve => child.on('close',code => { finished=true; resolve(code); }));
const reads: {ms:number;ok:boolean;error?:string}[]=[];
while (!finished) {
 const t=Date.now();
 try {
  await prisma.$transaction(async tx => { await tx.$executeRaw`SET LOCAL statement_timeout = '2000ms'`; await tx.$queryRaw`SELECT count(*) FROM "Job" WHERE "isActive"`; });
  reads.push({ms:Date.now()-t,ok:true});
 } catch(e) { reads.push({ms:Date.now()-t,ok:false,error:String(e).slice(0,500)}); }
 await new Promise(r=>setTimeout(r,500));
}
const code=await done;
await prisma.$disconnect();
fs.writeFileSync('audits/2026-09-08/deployment/migration-rehearsal.json',JSON.stringify({at:new Date().toISOString(),exitCode:code,elapsedMs:Date.now()-start,readFailures:reads.filter(x=>!x.ok).length,reads,output},null,2));
console.log(JSON.stringify({exitCode:code,elapsedMs:Date.now()-start,readChecks:reads.length,readFailures:reads.filter(x=>!x.ok).length}));
if(code!==0||reads.some(x=>!x.ok))process.exitCode=1;
