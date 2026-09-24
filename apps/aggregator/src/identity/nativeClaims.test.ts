import { describe, expect, it } from 'vitest';
import { applyNativeEmployerRules, nativeEmployerRules, type NativeEmployerRule } from './nativeClaims.js';
import { recoverRetainedPublication } from '../publication/recovery.js';
import type { NormalizedJob } from '../types.js';

const job: NormalizedJob = { externalId: '1', title: 'Licensing Assistant Manager',
  url: 'https://jobs.lever.co/hottopic/1', raw: { descriptionPlain: 'Hot Topic, Inc. is looking for a Licensing Assistant Manager.' } };
const rule: NativeEmployerRule = { id: 'own-recruitment', employer: { name: 'Hot Topic, Inc.', role: 'EMPLOYER' },
  when: [{ path: 'descriptionPlain', includes: 'Hot Topic, Inc. is looking for' }] };

describe('reviewed native statements', () => {
  it('keeps exact RAW, field and witnessed statement, without inventing a parent or sector', () => {
    const result = applyNativeEmployerRules(job, [rule]);
    expect(result.raw).toBe(job.raw);
    expect(result).toMatchObject({ company: 'Hot Topic, Inc.', employerEvidence: { role: 'EMPLOYER',
      statements: [{ ruleId: rule.id, witnesses: [{ path: 'descriptionPlain', quote: 'Hot Topic, Inc. is looking for' }] }] } });
    expect(result.group).toBeUndefined();
  });
  it('does not infer an employer from a publisher, footer, code or incidental mention', () => {
    const unrelated = { ...job, raw: { descriptionPlain: 'Our anonymous client is looking for a manager.', footer: 'Hot Topic, Inc.' } };
    expect(applyNativeEmployerRules(unrelated, [rule]).company).toBeUndefined();
    expect(applyNativeEmployerRules({ ...job, raw: { descriptionPlain: 'Hot Topic, Inc. products. Our client is looking for staff.' } },
      [{ ...rule, when: [{ path: 'descriptionPlain', includes: 'is looking for' }] }]).company).toBeUndefined();
  });
  it('requires every condition and does not use inherited properties', () => {
    const restricted = { ...rule, when: [...rule.when, { path: 'categories.department', equals: 'Legal' }] };
    expect(applyNativeEmployerRules(job, [restricted])).toBe(job);
    expect(applyNativeEmployerRules({ ...job, raw: Object.create(job.raw as object) }, [rule]).company).toBeUndefined();
  });
  it('does not treat a short company name as a substring of another word', () => {
    const fragment: NativeEmployerRule = { id: 'short-name', employer: { name: 'On', role: 'BRAND' },
      when: [{ path: 'descriptionPlain', includes: 'London recruits' }] };
    expect(applyNativeEmployerRules({ ...job, raw: { descriptionPlain: 'London recruits' } }, [fragment]).company).toBeUndefined();
  });
  it('holds contradictory native names and roles, preserving an existing hold', () => {
    expect(applyNativeEmployerRules({ ...job, company: 'Other employer' }, [rule]).publicationHold).toBe('NATIVE_EMPLOYER_CONFLICT');
    expect(applyNativeEmployerRules(job, [rule, { ...rule, id: 'other-role', employer: { ...rule.employer, role: 'BRAND' } }]).publicationHold).toBe('NATIVE_EMPLOYER_CONFLICT');
    const held = { ...job, publicationHold: 'APPLICATION_EXPLICITLY_CLOSED' };
    expect(applyNativeEmployerRules(held, [rule])).toBe(held);
  });
  it('a broad group statement does not replace a more specific native Maison', () => {
    const group: NativeEmployerRule = { id: 'group', employer: { name: 'Groupe Chantelle', role: 'GROUP' },
      when: [{ path: 'entityDescription', startsWith: 'Nous sommes le Groupe Chantelle' }] };
    const raw = { entityDescription: 'Nous sommes le Groupe Chantelle — six marques dont Darjeeling.' };
    expect(applyNativeEmployerRules({ ...job, raw }, [group]).company).toBe('Groupe Chantelle');
    expect(applyNativeEmployerRules({ ...job, company: 'Darjeeling', raw }, [group]).company).toBe('Darjeeling');
  });
  it('reads HTML entities identically and replays the complete retained native payload', () => {
    const raw = { id: '1', text: job.title, hostedUrl: job.url,
      description: '<p>Hot Topic, Inc. is looking for a Licensing Assistant Manager.</p>' };
    const config = { nativeEmployerRules: [{ ...rule, when: [{ path: 'description', startsWith: 'Hot Topic, Inc. is looking for' }] }] };
    const recovered = recoverRetainedPublication('lever', raw, { externalId: '1', url: job.url, observedAt: new Date(), config });
    expect(recovered).toMatchObject({ status: 'RECOVERABLE', job: { company: 'Hot Topic, Inc.', raw } });
  });
  it('rejects malformed configuration rather than silently changing its meaning', () => {
    expect(nativeEmployerRules({})).toEqual([]);
    expect(nativeEmployerRules({ nativeEmployerRules: [rule] })).toEqual([rule]);
    for (const bad of [null, {}, [rule, rule], [{ ...rule, typo: true }], [{ ...rule, employer: { name: 'Publisher', role: 'PUBLISHER' } }],
      [{ ...rule, when: [{ path: '__proto__.name', equals: 'x' }] }],
      [{ ...rule, when: [{ path: 'descriptionPlain', equals: 'x', includes: 'y' }] }],
      [{ ...rule, when: [{ path: 'descriptionPlain', includes: '' }] }]]) {
      expect(() => nativeEmployerRules({ nativeEmployerRules: bad })).toThrow();
    }
  });
});
