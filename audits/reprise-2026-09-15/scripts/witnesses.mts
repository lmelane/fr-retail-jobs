import { writeFileSync } from 'node:fs';
import { reattestationFields } from '/Users/lmelane/Downloads/catwalks-job-aggregator/apps/aggregator/src/dedup/upsert.ts';
import { resolveCanonicalDimensions } from '/Users/lmelane/Downloads/catwalks-job-aggregator/apps/aggregator/src/trust/resolve.ts';
import { readWorkplaceField } from '/Users/lmelane/Downloads/catwalks-job-aggregator/apps/aggregator/src/normalize/workplace.ts';
import { coerceAmount } from '/Users/lmelane/Downloads/catwalks-job-aggregator/apps/aggregator/src/lib/normalize.ts';
import { isProbableDuplicate } from '/Users/lmelane/Downloads/catwalks-job-aggregator/apps/aggregator/src/dedup/match.ts';
const base={externalId:'a',title:'Sales Advisor',company:'Example',sourceKey:'one',sourceTier:'EMPLOYER_DIRECT',url:'https://example.org/job/a',country:'US',city:'Boston'};
const existing={...base,countryCode:'US',isFrance:false,city:'Boston',location:'Boston',countryIntegrity:'RAW_COUNTRY',adminArea1:null,experienceYears:null,educationLevel:null,latitude:null,longitude:null,postalCode:null,department:null,salaryMin:null,salaryMax:null,salaryCurrency:null,salaryPeriod:null};
const rows=[
 {name:'authoritative_refresh_drops_experience_education_coordinates',input:{experienceYears:5,educationLevel:'SOURCE:degree',latitude:42.36,longitude:-71.06,postalCode:'02108',department:'Retail'},actual:reattestationFields({...base,experienceYears:5,educationLevel:'SOURCE:degree',latitude:42.36,longitude:-71.06,postalCode:'02108',department:'Retail'} as any,existing as any,true)},
 {name:'explicit_no_remote_misread',actual:readWorkplaceField('workplaceType','No remote')},
 {name:'hybrid_flags_misread',actual:resolveCanonicalDimensions({sourceKey:'sample',title:'Sales Advisor',raw:{remote:false,hybrid:true,on_site:false}})},
 {name:'salary_coercion_preserves_decimal_hypothesis_refuted',input:12.31,actual:coerceAmount(12.31)},
 {name:'distinct_roles_same_city_fuzzy_merge',actual:isProbableDuplicate(base as any,{...base,sourceKey:'two',externalId:'b',title:'Beauty Advisor',url:'https://example.net/job/b'} as any)},
];console.log(JSON.stringify(rows,null,2));writeFileSync('/tmp/catwalks-audit-20260915/witnesses.json',JSON.stringify(rows,null,2));
