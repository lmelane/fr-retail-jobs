import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root=fileURLToPath(new URL('../../../../',import.meta.url));
const candidate={key:'witness',maison:'Witness',kind:'teamtailor',config:{origin:'https://witness.example'},careersDomain:'witness.example',tier:'EMPLOYER_DIRECT'};
function refusal(change,pattern) {
  const dir=mkdtempSync(join(tmpdir(),'cw-golden-guard-'));
  try {
    const input=join(dir,'candidate.json'),out=join(dir,'result');
    writeFileSync(input,JSON.stringify(candidate));
    const env={...process.env,DATABASE_URL:'postgresql://fake:fake@127.0.0.1:1/catwalks_stack_catalogue',OBSERVATION_ARCHIVE_S3_ENDPOINT:'http://127.0.0.1:1'};
    change({input,out,env,dir});
    const existed=existsSync(out);
    const r=spawnSync(process.execPath,['--import','tsx','apps/aggregator/scripts/ops/golden-source.mts',`--candidate=${input}`,`--out-dir=${out}`,'--reviewer=test'],{cwd:root,env,encoding:'utf8',timeout:15000});
    assert.equal(r.status,1);assert.match(r.stderr,pattern);
    assert.equal(existsSync(out),existed,'Le refus doit précéder toute création de dossier/base');
  } finally {rmSync(dir,{recursive:true,force:true});}
}
test('refuse une base distante avant toute écriture',()=>refusal(({env})=>{env.DATABASE_URL='postgresql://fake:fake@db.example/catwalks_stack_catalogue';},/exige stack:exec/));
test('refuse la base de répétition même locale',()=>refusal(({env})=>{env.DATABASE_URL='postgresql://fake:fake@127.0.0.1:1/catwalks_consolide_rehearsal';},/exige stack:exec/));
test('refuse une archive distante',()=>refusal(({env})=>{env.OBSERVATION_ARCHIVE_S3_ENDPOINT='https://archive.example';},/exige stack:exec/));
test('refuse un candidat invalide avant de créer une base',()=>refusal(({input})=>{writeFileSync(input,JSON.stringify({...candidate,kind:'invented'}));},/Invalid source candidate/));
test('ne réutilise pas un dossier de preuve existant',()=>refusal(({out})=>{writeFileSync(out,'preuve');},/dossier de preuve doit être nouveau/));
