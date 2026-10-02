/**
 * Le BULLETIN DE LA BOUCLE CANDIDAT, tel qu'il part après chaque RUN (R-143 §9, §11 ; D-515 §4, §5 ; D-516 §2). Pur.
 *
 * Court, lisible sur un écran de 375 px (blocs empilés, comme le bilan d'ingestion), sans tiret cadratin (D-319) :
 *   1. l'alerte de couverture : ce qui est à réparer, puis à vérifier, puis, pour information, ce qui ne réveille
 *      personne (fermetures prouvées, retenues et pauses décidées, doublons regroupés). Chaque ligne dit la Maison ou le
 *      marché, la part perdue, la cause et l'action ;
 *   2. un indicateur par question du CEO, avec sa définition et son dénominateur.
 */
import { CAUSE_GRAVITY, newAlerts, THRESHOLDS, REFERENCE_RUNS, MIN_REFERENCE_RUNS, KNOWN_SOURCE_FLOOR, LOSS_CAUSES, type AlertCause,
  type CoverageEvaluation, type CoverageFinding, type Gravity } from './coverageAlert.js';
import type { MaskedStock } from './coverageReading.js';
import type { Indicator } from './loopIndicators.js';

const NUMBER = new Intl.NumberFormat('fr-FR');
const n = (value: number) => NUMBER.format(Math.round(value));
const pct = (value: number) => `${NUMBER.format(Math.round(value * 1000) / 10)} %`;
const utc = (at: Date) => `${at.toISOString().slice(8, 10)}/${at.toISOString().slice(5, 7)} ${at.toISOString().slice(11, 16)} UTC`;

export const CAUSE_LABEL: Readonly<Record<AlertCause, string>> = {
  COLLECTE: 'collecte en échec ou incomplète (de notre côté)',
  NON_REVUE: 'masquée : une collecte crédible ne la liste plus',
  LIEN_MORT: 'masquée : lien de candidature mort',
  FERMETURE_SOURCE: 'fermeture prouvée par la source',
  RETENUE_REGLE: 'retenue par une règle ou une décision (D-511, D-512, D-514, identité, périmètre)',
  PAUSE_DECIDEE: 'pause ou retrait de la source décidé',
  REGROUPEE: 'doublons regroupés',
  INEXPLIQUEE: 'aucune cause trouvée',
};
const GRAVITY_LABEL: Readonly<Record<Gravity, string>> = { A_REPARER: 'À réparer', A_VERIFIER: 'À vérifier', INFORMATION: 'Pour information' };
const SCOPE_LABEL = { MAISON: 'Maison', MARCHE: 'Marché', SOURCE: 'Source' } as const;
const KIND_LABEL = { PERTE: 'perte', MENACE: 'menace', NON_SERVIE: 'non servie' } as const;

/** Escapes a value for the HTML; an em dash from a source's own error text is reworded (D-319). */
export function esc(value: string): string {
  return value.replace(/\s*\u2014\s*/g, ', ').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export function bulletinSubject(evaluation: CoverageEvaluation): string {
  const fresh = newAlerts(evaluation);
  const repair = fresh.filter(f => f.gravity === 'A_REPARER').length, verify = fresh.filter(f => f.gravity === 'A_VERIFIER').length;
  const ongoing = evaluation.findings.filter(f => f.gravity !== 'INFORMATION' && f.ongoing).length;
  const info = evaluation.findings.filter(f => f.gravity === 'INFORMATION').length;
  const head = repair + verify === 0 ? 'rien de nouveau à réparer ni à vérifier'
    : [repair ? `${repair} à réparer` : '', verify ? `${verify} à vérifier` : ''].filter(Boolean).join(', ');
  const tail = [ongoing ? `${ongoing} en cours` : '', info ? `${info} pour information` : ''].filter(Boolean).join(', ');
  return `[Catwalks] Couverture : ${head}${tail ? ` (${tail})` : ''} · boucle candidat`;
}

/** Ce qu'il faut faire, source par source. */
export function actionLines(finding: CoverageFinding): string[] {
  if (finding.cause === 'INEXPLIQUEE') return [`Instruire : aucune sortie connue n’explique ${n(finding.lost)} offres ; rejouer avec la commande coverage.`];
  if (CAUSE_GRAVITY[finding.cause] === 'INFORMATION') return [];
  return finding.sources.map(source => {
    const where = source.url ? ` · ${source.url}` : '';
    if (finding.cause === 'COLLECTE') {
      const state = [source.status, source.note].filter(Boolean).join(' : ');
      const mask = source.maskAt ? ` ; masquées à partir du ${utc(source.maskAt)} si la collecte ne reprend pas` : '';
      return `Source à réparer : ${source.sourceKey} (${n(source.count)}${state ? ` ; ${state}` : ''})${mask}${where} ; relancer : ingest --source=${source.sourceKey}`;
    }
    if (finding.cause === 'LIEN_MORT') return `Source : ${source.sourceKey} (${n(source.count)})${where} ; relire les liens : probe-apply-links --dry-run`;
    return `Source : ${source.sourceKey} (${n(source.count)})${where} ; vérifier sur son site que ces offres n’y sont plus ; plan : availability --dry-run`;
  });
}

/** Les lignes d'un constat, la première dit tout : entité, part perdue, cause. */
export function findingLines(finding: CoverageFinding): string[] {
  const status = finding.ongoing ? 'en cours' : 'nouvelle';
  const head = `${SCOPE_LABEL[finding.scope]} ${finding.label} · ${KIND_LABEL[finding.kind]} · ${CAUSE_LABEL[finding.cause]} · ${status}`;
  const amount = finding.kind === 'PERTE'
    ? `${n(finding.lost)} offres servies en moins (${pct(finding.share)}) : ${n(finding.served)} contre ${n(finding.reference ?? 0)} ${finding.basis === 'RUN' ? 'avant ce RUN' : 'd’habitude'}`
    : finding.kind === 'MENACE'
      ? `${n(finding.lost)} offres servies ne tiennent qu’à cette collecte, en échec à ce RUN`
      : `${n(finding.lost)} offres lues à la dernière qualification, aucune servie`;
  const breakdown = finding.breakdown.length > 1 ? [`dont ${finding.breakdown.map(p => `${n(p.count)} ${CAUSE_LABEL[p.cause]}`).join(' ; ')}`] : [];
  const impacts = finding.impacts?.length
    ? [`touche : ${finding.impacts.slice(0, 6).map(i => `${i.scope === 'MARCHE' ? 'marché ' : ''}${i.label} ${n(i.count)} (${pct(i.share)})`).join(' ; ')}${finding.impacts.length > 6 ? ` ; et ${finding.impacts.length - 6} autres` : ''}`]
    : [];
  return [head, amount, ...impacts, ...breakdown, ...actionLines(finding)];
}

const line = (text: string, muted = true) =>
  `<p style="margin:2px 0;${muted ? 'color:#767676;' : ''}overflow-wrap:anywhere;word-break:break-word">${text}</p>`;
const heading = (text: string) => `<h3 style="font-weight:400;font-size:17px;margin:24px 0 4px">${text}</h3>`;
const block = (lines: string[], key: string) => `<div data-entite="${esc(key)}" style="border-top:1px solid #E1E1E1;padding:10px 0">
      ${lines.map((text, i) => line(i === 0 ? `<strong>${esc(text)}</strong>` : esc(text), i !== 0)).join('')}
    </div>`;
/** Au-delà, une ligne compacte nomme le reste : un RUN où tout casse (23/09 : 181 sources) reste lisible. */
const SHOWN: Readonly<Record<Gravity, number>> = { A_REPARER: 25, A_VERIFIER: 25, INFORMATION: 15 };
const compact = (f: CoverageFinding) => `${SCOPE_LABEL[f.scope]} ${f.label} (${n(f.lost)}, ${pct(f.share)})`;

/** En tête : ce que le RUN a retiré, les sources à traiter, et ce qui reste masqué. Lisible en dix secondes. */
export function summaryLines(evaluation: CoverageEvaluation, masked: MaskedStock | null): string[] {
  const lines: string[] = [];
  if (evaluation.runExits) {
    const parts = LOSS_CAUSES.filter(c => (evaluation.runExits![c] ?? 0) > 0).map(c => `${n(evaluation.runExits![c]!)} ${CAUSE_LABEL[c]}`);
    const total = Object.values(evaluation.runExits).reduce((s, v) => s + (v ?? 0), 0);
    lines.push(total ? `Ce RUN a retiré ${n(total)} offres de l’expérience candidat : ${parts.join(' ; ')}.` : 'Ce RUN n’a retiré aucune offre de l’expérience candidat.');
  }
  const sources = new Map<string, { count: number; gravity: Gravity }>();
  for (const f of evaluation.findings) {
    if (f.gravity === 'INFORMATION' || f.scope === 'MARCHE') continue;
    for (const s of f.sources) {
      const acc = sources.get(s.sourceKey) ?? { count: 0, gravity: f.gravity };
      acc.count += s.count;
      if (f.gravity === 'A_REPARER') acc.gravity = 'A_REPARER';
      sources.set(s.sourceKey, acc);
    }
  }
  if (sources.size) lines.push(`Sources à traiter : ${[...sources.entries()].sort((a, b) => b[1].count - a[1].count).slice(0, 12)
    .map(([key, acc]) => `${key} ${n(acc.count)} (${GRAVITY_LABEL[acc.gravity].toLowerCase()})`).join(' ; ')}${sources.size > 12 ? ` ; et ${sources.size - 12} autres` : ''}.`);
  if (masked) lines.push(masked.total ? `Masquées en ce moment : ${n(masked.total)} offres ; par Maison : ${masked.maisons.slice(0, 15)
    .map(m => `${m.label} ${n(m.count)}`).join(' ; ')}${masked.maisons.length > 15 ? ` ; et ${masked.maisons.length - 15} autres` : ''}.` : 'Masquées en ce moment : aucune.');
  return lines;
}

export function bulletinHtml(evaluation: CoverageEvaluation, indicators: readonly Indicator[], meta: { at: Date; masked?: MaskedStock | null }): string {
  const section = (gravity: Gravity, intro: string) => {
    const list = evaluation.findings.filter(f => f.gravity === gravity);
    if (!list.length) return '';
    // Les marchés recomptent les Maisons : une ligne compacte, pas un bloc chacun.
    const markets = list.filter(f => f.scope === 'MARCHE'), others = list.filter(f => f.scope !== 'MARCHE');
    const shown = others.slice(0, SHOWN[gravity]), rest = others.slice(SHOWN[gravity]);
    return `${heading(`${GRAVITY_LABEL[gravity]} : ${list.length}`)}${line(intro)}
    ${markets.length ? line(esc(`Marchés : ${markets.map(f => `${f.label} ${n(f.lost)} en moins (${pct(f.share)}, ${CAUSE_LABEL[f.cause]})`).join(' ; ')}.`), false) : ''}
    ${shown.map(f => block(findingLines(f), `${f.scope}:${f.key}:${f.kind}`)).join('')}
    ${rest.length ? line(esc(`Et aussi : ${rest.map(compact).join(' ; ')}.`)) : ''}`;
  };
  const reference = [evaluation.runExits ? 'Perte de ce RUN : comparée aux offres servies juste avant ses étapes qui retirent.' : '',
    evaluation.referenceRuns
      ? `Perte d’habitude : médiane des ${evaluation.referenceRuns} derniers RUN photographiés depuis le ${utc(evaluation.windowStart!)}, ou le dernier s’il est plus haut.`
      : `Perte d’habitude : référence en construction (${MIN_REFERENCE_RUNS} RUN photographiés nécessaires).`].filter(Boolean).join(' ');
  const rules = `Significatif : Maison, au moins ${THRESHOLDS.MAISON.floor} offres et ${pct(THRESHOLDS.MAISON.share)}, ou ${THRESHOLDS.MAISON.big} offres ; marché, au moins ${THRESHOLDS.MARCHE.floor} offres et ${pct(THRESHOLDS.MARCHE.share)}, ou ${THRESHOLDS.MARCHE.big} offres ; source qualifiée d’au moins ${KNOWN_SOURCE_FLOOR} offres qui n’en sert aucune. Fenêtre : ${REFERENCE_RUNS} RUN au plus.`;
  const anything = evaluation.findings.length > 0;
  const indicatorBlocks = indicators.map(i => block([`${i.question}. ${i.title} : ${i.value}`, `Définition : ${i.definition}`,
    `Dénominateur : ${i.denominator}`], `indicateur:${i.question}`)).join('');
  return `<div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;color:#000;max-width:600px;font-size:14px;line-height:1.45">
    <h2 style="font-weight:400;font-size:20px">Boucle candidat : RUN du ${esc(utc(meta.at))}</h2>
    ${summaryLines(evaluation, meta.masked ?? null).map(text => line(esc(text), false)).join('')}
    ${heading('7. Couverture : ce qu’on perd')}
    ${line(esc(reference))}
    ${anything ? '' : line('Aucune Maison, aucun marché ne perd significativement de couverture, aucune collecte en échec ne menace une part significative d’une Maison ou d’un marché.', false)}
    ${section('A_REPARER', 'De notre côté, ou sans cause trouvée : un trou à réparer.')}
    ${section('A_VERIFIER', 'Offres masquées ou retirées sans preuve de fin : vérifier sur le site de la source qu’elles n’y sont plus.')}
    ${section('INFORMATION', 'Normal : rien à faire.')}
    ${heading('Les questions de la boucle')}
    ${indicatorBlocks}
    ${line(`${esc(rules)} Rejouer en lecture seule, sans envoi : commande coverage.`)}
  </div>`;
}

/** La version texte (journal et commande `coverage`). */
export function bulletinText(evaluation: CoverageEvaluation, indicators: readonly Indicator[]): string[] {
  return [...evaluation.findings.map(f => `${GRAVITY_LABEL[f.gravity]} · ${findingLines(f).join(' | ')}`),
    ...indicators.map(i => `${i.question}. ${i.title} : ${i.value} (dénominateur : ${i.denominator})`)];
}
