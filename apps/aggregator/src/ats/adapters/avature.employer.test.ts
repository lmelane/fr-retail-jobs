import { describe, expect, it } from 'vitest';
import { avatureJobData, applyAvatureJobData } from './avature.js';
import { recoverRetainedPublication } from '../../publication/recovery.js';
// Native public metadata from L'Oréal job 241889, observed 2026-09-23.
const script = `var dataLayer = window["dataLayer"] || [];
dataLayer.push ({language: "en", brand: "OA", country: "inter", siteTypeLevel: "main",
pageCategory: "job detail page", jobTitle: "[L'OREAL Taiwan] Visual Merchandiser, Aesop",
jobFunction: "Marketing", jobDivision: "L'Oreal Luxe", jobBrand: "Aesop",
jobEmploymentType: "Full - Time", jobPositionType: "Permanent", jobCountry: "Taiwan Region",
jobLocation: "Taipei, Taiwan", jobIDATS: "241889", portalIDATS: "170"});`;
const job = { externalId: '241889', title: 'Visual Merchandiser, Aesop',
  url: 'https://careers.loreal.com/en_US/jobs/JobDetail/L-OREAL-Taiwan-Visual-Merchandiser-Aesop/241889',
  description: 'Native description of the Visual Merchandiser role. '.repeat(20),
  raw: { source: 'avature', externalId: '241889', title: 'Visual Merchandiser, Aesop',
    url: 'https://careers.loreal.com/en_US/jobs/JobDetail/L-OREAL-Taiwan-Visual-Merchandiser-Aesop/241889',
    description: 'Native description of the Visual Merchandiser role. '.repeat(20) } };
describe('Avature native per-job brand', () => {
  it('reads jobBrand bound to jobIDATS, without substituting the site or division brand', () => {
    expect(avatureJobData(script, '241889')).toEqual({ jobBrand: 'Aesop', jobCountry: 'Taiwan Region' });
    expect(applyAvatureJobData(job, script)).toMatchObject({ company: 'Aesop',
      employerEvidence: { rawName: 'Aesop', path: 'dataLayer.jobBrand', rule: 'EXPLICIT_JOB_BRAND' } });
  });
  it('rejects wrong IDs, missing brands, duplicate fields and conflicting metadata blocks', () => {
    expect(avatureJobData(script, '999')).toBeNull();
    expect(avatureJobData(script.replace('jobBrand: "Aesop",', ''), '241889')).toBeNull();
    expect(avatureJobData(script.replace('jobBrand: "Aesop"', 'jobBrand: "Aesop", jobBrand: "Other"'), '241889')).toBeNull();
    expect(avatureJobData(script + script.replace('jobBrand: "Aesop"', 'jobBrand: "Other"'), '241889')).toBeNull();
    expect(avatureJobData(script.replace('"Aesop",', 'getBrand(),'), '241889')).toBeNull();
    expect(avatureJobData(script.replace('jobBrand: "Aesop"', 'jobBrand: "N/A"'), '241889')).toBeNull();
    expect(avatureJobData(script.replace('jobBrand: "Aesop"', 'jobBrand: "Multi Brand"'), '241889')).toBeNull();
    expect(avatureJobData(script.replace('jobBrand: "Aesop"', 'jobBrand: "L&#039;Oréal Paris"'), '241889')).toEqual({ jobBrand: "L'Oréal Paris", jobCountry: "Taiwan Region" });
  });
  it('reconstructs the employer from the retained native metadata only with the reviewed option', () => {
    const observed = applyAvatureJobData(job, script);
    const context = { externalId: job.externalId, url: job.url, observedAt: new Date('2026-09-23T20:00:00Z'),
      config: { employerFromDataLayer: true } };
    const recovered = recoverRetainedPublication('avature', observed.raw, context);
    expect(recovered.status).toBe('RECOVERABLE');
    if (recovered.status === 'RECOVERABLE') expect(recovered.job).toMatchObject({ company: 'Aesop', country: 'Taiwan Region', employerEvidence: observed.employerEvidence });
    const disabled = recoverRetainedPublication('avature', observed.raw, { ...context, config: {} });
    if (disabled.status === 'RECOVERABLE') expect(disabled.job.company).toBeUndefined();
    const wrong = recoverRetainedPublication('avature', { ...(observed.raw as object), avatureJobData: script.replace('241889', '999') }, context);
    if (wrong.status === 'RECOVERABLE') expect(wrong.job.company).toBeUndefined();
  });
});
