import type { Fact, Evidence, WorkplaceMode, WorkplaceValue } from '@catwalks/db/source-facts';
import { KIND_TO_ATS } from '../ats/catalogKinds.js';
import { at, object } from './types.js';

const LABELS: Record<string, WorkplaceMode> = {
  remote: 'REMOTE', 'full remote': 'REMOTE', 'fully remote': 'REMOTE',
  hybrid: 'HYBRID', hybride: 'HYBRID', híbrido: 'HYBRID', hybryda: 'HYBRID', ibrido: 'HYBRID',
  onsite: 'ONSITE', 'on-site': 'ONSITE', 'on site': 'ONSITE', 'in store': 'ONSITE', 'in office': 'ONSITE',
  'sur site': 'ONSITE', 'no remote': 'ONSITE', 'pas de télétravail': 'ONSITE',
};

/** Source-specific paths and meanings. A false remote flag never implies an on-site job. */
export function readWorkplace(type: string, raw: unknown): Fact<WorkplaceValue> {
  if (!object(raw)) return { status: 'INPUT_MISSING', value: null, evidence: [], issues: [] };
  const kind = KIND_TO_ATS[type] ?? type, evidence: Evidence[] = [], issues: string[] = [];
  const modes = new Set<WorkplaceMode>(), nativeLabels: string[] = [];
  const take = (path: string) => { const value = at(raw, path); if (value !== undefined) evidence.push({ path, value }); return value; };
  const label = (path: string, dictionary = LABELS) => {
    const value = take(path);
    for (const entry of Array.isArray(value) ? value : [value]) {
      if (entry == null || entry === '') continue;
      if (typeof entry !== 'string') { issues.push('UNINTERPRETED_WORKPLACE_VALUE'); continue; }
      nativeLabels.push(entry);
      const key = entry.trim().toLowerCase();
      if (dictionary[key]) modes.add(dictionary[key]);
      else if (!['unknown','unspecified'].includes(key)) issues.push('UNINTERPRETED_WORKPLACE_VALUE');
    }
  };
  const flag = (path: string, mode: WorkplaceMode) => {
    const value = take(path);
    if (value === true) modes.add(mode);
    else if (value != null && value !== false) issues.push('UNINTERPRETED_WORKPLACE_FLAG');
    return value;
  };
  switch (kind) {
    case 'RECRUITEE':
      // Each flag is a separate accepted work type: preserve all true choices.
      flag('/on_site','ONSITE'); flag('/hybrid','HYBRID'); flag('/remote','REMOTE'); break;
    case 'SMARTRECRUITERS': flag('/location/hybrid','HYBRID'); flag('/location/remote','REMOTE'); break;
    case 'ASHBY': {
      label('/workplaceType'); const explicit = [...modes]; const remote = flag('/isRemote','REMOTE');
      if (remote === true && explicit.length && !explicit.includes('REMOTE'))
        return { status: 'CONFLICT', value: null, evidence, issues: ['CONTRADICTORY_WORKPLACE_FIELDS'] };
      break;
    }
    case 'LEVER': label('/workplaceType'); break;
    case 'EIGHTFOLD': label('/workLocationOption', { ...LABELS, remote_local: 'REMOTE' }); break;
    case 'WORKDAY': label('/detail/jobPostingInfo/remoteType'); break;
    case 'SUCCESSFACTORS': label('/custOnsiteRemote'); break;
    case 'WTTJ': label('/remote', { no: 'ONSITE', partial: 'HYBRID', fulltime: 'REMOTE', full: 'REMOTE', punctual: 'OCCASIONAL_REMOTE' }); break;
    case 'FLATCHR': label('/vacancy/remote', { notime: 'ONSITE', fulltime: 'REMOTE', partial: 'HYBRID', punctual: 'OCCASIONAL_REMOTE' }); break;
    case 'MAGNET': label('/remote_work_type', {
      'http://www.rj.com/commun/teletravail/pas_teletravail': 'ONSITE',
      'http://www.rj.com/commun/teletravail/occasionnel': 'OCCASIONAL_REMOTE',
      'http://www.rj.com/commun/teletravail/partiel': 'HYBRID',
      'http://www.rj.com/commun/teletravail/total': 'REMOTE',
    }); break;
    case 'WORKABLE': flag('/telecommuting','REMOTE'); break;
    case 'TALENT_FUNNEL': flag('/detail/positionProfile/remoteWorking','REMOTE'); break;
    case 'TALENTVIEW': {
      const value = take('/detail/remote_level');
      // Verified against the publisher's remoteLevels dictionary and live postings.
      // See lot-3-talentview-vocabulary.json; 1 is occasional remote, never on-site.
      const dictionary: Record<string, WorkplaceMode> = { '0': 'ONSITE', '1': 'OCCASIONAL_REMOTE', '2': 'HYBRID', '3': 'REMOTE' };
      if (value != null) {
        const mode = typeof value === 'number' || typeof value === 'string' ? dictionary[String(value)] : undefined;
        if (mode) modes.add(mode); else issues.push('UNINTERPRETED_WORKPLACE_CODE');
      }
      break;
    }
    case 'TEAMTAILOR': label('/_jobposting/jobLocationType', { telecommute: 'REMOTE' }); break;
    case 'ICIMS': label('/postingEvidence/jobPosting/jobLocationType', { telecommute: 'REMOTE' }); break;
    case 'GENERIC_JSONLD': label('/jobLocationType', { telecommute: 'REMOTE' }); break;
    default: return { status: 'UNINTERPRETED', value: null, evidence: [], issues: ['WORKPLACE_READER_NOT_QUALIFIED'] };
  }
  return { status: modes.size ? 'DECLARED' : issues.length ? 'UNINTERPRETED' : 'NOT_OBSERVED',
    value: modes.size ? { modes: [...modes], nativeLabels } : null, evidence, issues: [...new Set(issues)] };
}
