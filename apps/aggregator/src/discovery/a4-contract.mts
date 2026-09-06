import { normalizeContract, normalizeWorkingTime, isWorkingTimeValue } from '../normalize/contract.js';
/** Audit a4 — ce que les normaliseurs rendent pour les valeurs réellement publiées par les ATS (aucun réseau). */
for (const v of ['PART_TIME', 'FULL_TIME', 'Part time', 'Full time', 'Part-time', 'Teilzeit', 'Fulltime-Regular', 'Fulltime-Temporary', 'permanent', 'Regular Part-Time', 'Variable', 'INTERN', 'TEMPORARY', 'OTHER'])
  console.log(JSON.stringify(v).padEnd(22), 'contract=', normalizeContract(v).padEnd(8), 'workingTime=', normalizeWorkingTime(v).padEnd(13), 'misfiled=', isWorkingTimeValue(v));
