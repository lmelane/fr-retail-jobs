import '../test/setup-integration.js';
import { PrismaClient } from '@prisma/client';
import { afterAll, beforeEach, expect, it } from 'vitest';
import { registerSourceCandidate } from '../connectors/sourceCandidate.js';
const p=new PrismaClient();const keys=['candidate-test','candidate-copy'];
beforeEach(()=>p.source.deleteMany({where:{key:{in:keys}}}));afterAll(async()=>{await p.source.deleteMany({where:{key:{in:keys}}});await p.$disconnect();});
const candidate={key:keys[0],maison:'Example',kind:'harri',config:{slug:'Example-Careers'},careersDomain:'harri.com',tier:'ATS_OFFICIAL' as const};
it('registers DRAFT without fabricated proof and preserves operational state on replay',async()=>{
 const first=await registerSourceCandidate(p,candidate);expect(first).toMatchObject({created:true,source:{status:'DRAFT',verifiedJobCount:null,robotsCheckedAt:null}});
 await p.source.update({where:{key:candidate.key},data:{status:'RETIRED'}});
 expect(await registerSourceCandidate(p,candidate)).toMatchObject({created:false,source:{status:'RETIRED'}});
 await expect(registerSourceCandidate(p,{...candidate,maison:'Other'})).rejects.toThrow('conflicts');
});
it('refuses two candidates naming the same tenant instead of creating fragmented employers',async()=>{
 await registerSourceCandidate(p,candidate);
 await expect(registerSourceCandidate(p,{...candidate,key:keys[1],config:{portalUrl:'https://harri.com/Example-Careers'}})).rejects.toThrow('Tenant already registered');
 expect(await p.source.count({where:{key:{in:keys}}})).toBe(1);
});
