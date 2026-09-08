/** Recheck all captured application evidence, with no private form sessions. */
import{readFileSync,writeFileSync}from'node:fs';import{parseJobaffinityApplication}from'../../../apps/aggregator/src/ats/adapters/jobaffinityWordpress.js';
const base='/Users/lmelane/Downloads/catwalks-job-aggregator/backups/remediation-20260908';
const closed=readFileSync(base+'/closed-jobaffinity.html','utf8');const closedDot=readFileSync(base+'/failed-apply.html','utf8');
for(const h of [closed,closedDot])if(parseJobaffinityApplication(h,'https://jobaffinity.fr/apply/h61g7nun6ryo2pzsf0').state!=='CLOSED')throw new Error('Closed template failed');
const h=readFileSync(base+'/apply-rpp3vwzazs9dmsf9f9.html','utf8');if(parseJobaffinityApplication(h,'https://jobaffinity.fr/apply/rpp3vwzazs9dmsf9f9').state!=='OPEN')throw new Error('Open template failed');
console.log('Original open and both observed closed HTML templates parsed correctly');
