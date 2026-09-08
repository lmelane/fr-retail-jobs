import * as cheerio from 'cheerio';
/** Candidate links only. External ATS links must not be lost; shop offers are not jobs. */
export function careerCandidates(html: string, baseUrl: string) {
  const $ = cheerio.load(html);
  const found = new Map<string,{from:string;to:string;label:string}>();
  $('a[href]').each((_,a)=>{
    const label = $(a).text().trim();
    const href = $(a).attr('href') ?? '';
    if (!/career|carri[eè]re|recrut|rejoindre|join\s+us|work\s+with\s+us|job\b|jobs\b|emploi|talents?|vacancies|offres\s+d['’]emploi/i.test(label+' '+href)) return;
    try {
      const url = new URL(href,baseUrl);
      if (!['http:','https:'].includes(url.protocol)) return;
      if (/cookie|privacy|confidential|newsletter/i.test(url.pathname+' '+label)) return;
      found.set(url.toString(),{from:baseUrl,to:url.toString(),label});
    } catch {}
  });
  return [...found.values()];
}
