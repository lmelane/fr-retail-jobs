'use client';

import { contractLabel, relativeDate } from '@/lib/format';
import { CompanyLogo } from '@/components/company-logo';
import { displayTitle } from '@/lib/format';
import type { JobRow } from '@/lib/jobs';

/**
 * Offer detail (design_2.md §4.7, réf emplois.html/offre.html), read in place.
 *
 * The description costs nothing extra: ATS APIs return it alongside the listing
 * (Greenhouse 6.7k characters, Ashby 20k, FashionJobs 4.9k), so the candidate
 * reads the full posting without leaving the page — and without us fetching it
 * per offer.
 *
 * Renders the panel CONTENT only (head + actions + blocks). The scroll and the
 * sticky positioning belong to the parent `.detail` container (JobsView on
 * /emplois, the /offre page standalone) so this component works identically in
 * both — one visual language for an offer wherever it is read.
 */

/** Source remote wording -> a clean French label. */
function remoteLabel(raw: string): string {
  const v = raw.trim().toLowerCase();
  if (/hybrid|hybride|partiel/.test(v)) return 'Hybride';
  if (/full|complet|100|remote|télétravail|teletravail/.test(v)) return 'Télétravail';
  if (/no|non|onsite|sur site|présentiel|presentiel/.test(v)) return 'Sur site';
  return raw;
}

/** "35 000 – 42 000 € par an", from whichever half the source published. */
function salaryLabel(job: JobRow): string | null {
  if (job.salaryMin === null && job.salaryMax === null) return null;

  const currency = job.salaryCurrency === 'EUR' ? '€' : (job.salaryCurrency ?? '');
  const amount = (value: number) => value.toLocaleString('fr-FR');
  const period =
    { YEAR: 'par an', MONTH: 'par mois', HOUR: 'de l’heure' }[job.salaryPeriod ?? ''] ?? '';

  const band =
    job.salaryMin !== null && job.salaryMax !== null && job.salaryMin !== job.salaryMax
      ? `${amount(job.salaryMin)} – ${amount(job.salaryMax)}`
      : amount((job.salaryMin ?? job.salaryMax) as number);

  return [band, currency, period].filter(Boolean).join(' ');
}

const ArrowGlyph = () => (
  <svg viewBox="0 0 24 24" aria-hidden width="16" height="16" stroke="currentColor" strokeWidth="1.25" fill="none" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12h14M13 6l6 6-6 6" /></svg>
);
const OutGlyph = () => (
  <svg viewBox="0 0 24 24" aria-hidden width="16" height="16" stroke="currentColor" strokeWidth="1.25" fill="none" strokeLinecap="round" strokeLinejoin="round"><path d="M7 17 17 7M8 7h9v9" /></svg>
);

/**
 * The structured fields, when the source published them (§4.7 « Détails de
 * l'emploi »). Coverage genuinely varies — each row appears only when it has a
 * value; printing "non précisé" would fill the panel with absences.
 */
function JobFacts({
  job,
  contract,
  salary,
}: {
  job: JobRow;
  contract: string | null;
  salary: string | null;
}) {
  const facts: [string, string][] = [];

  if (contract) facts.push(['Contrat', contract]);
  if (salary) facts.push(['Salaire', salary]);
  const workingTime = contractLabel(job.workingTime);
  if (workingTime) facts.push(['Temps de travail', workingTime]);
  if (job.remote && !/^(unknown|non pr[ée]cis[ée]|n\/?a|none|unspecified)$/i.test(job.remote.trim()))
    facts.push(['Télétravail', remoteLabel(job.remote)]);
  if (job.experienceYears !== null)
    facts.push(['Expérience', `${job.experienceYears} an${job.experienceYears > 1 ? 's' : ''}`]);
  if (job.educationLevel) facts.push(['Formation', job.educationLevel]);
  if (job.department) facts.push(['Département', job.department]);
  if (job.location) facts.push(['Lieu', job.location]);
  if (job.postedAt)
    facts.push(['Publiée le', new Date(job.postedAt).toLocaleDateString('fr-FR')]);
  if (job.validThrough)
    facts.push(['Candidature avant le', new Date(job.validThrough).toLocaleDateString('fr-FR')]);
  // No "Source" fact: which ATS/board a posting came from is internal plumbing,
  // not for the candidate's eyes.

  if (facts.length === 0) return null;

  return (
    <div className="block rule" style={{ paddingTop: 24 }}>
      <span className="t-caption green">Détails de l’emploi</span>
      <dl className="kv">
        {facts.map(([label, value]) => (
          <div key={label} className="contents">
            <dt>{label}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

export function JobDetail({ job }: { job: JobRow }) {
  const contract = contractLabel(job.contract);
  const salary = salaryLabel(job);

  // Meta line under the title: ville · contrat · télétravail · publiée.
  const remote =
    job.remote && !/^(unknown|non pr[ée]cis[ée]|n\/?a|none|unspecified)$/i.test(job.remote.trim())
      ? remoteLabel(job.remote)
      : null;
  const meta = [job.city, contract, remote, job.postedAt ? `Publiée ${relativeDate(job.postedAt)}` : null]
    .filter(Boolean)
    .join(' · ');

  return (
    <article key={job.id} aria-label="Détail de l’offre">
      <div className="detail__head">
        {/* Logo Maison (D9, réactivé par la review) — monogramme en repli. */}
        <CompanyLogo name={job.company} size={48} />
        <span className="t-caption self-center truncate">
          {job.company}
          {job.group ? <span className="muted"> · {job.group}</span> : null}
        </span>

        {/* « Sauvegarder » retiré (review 2026-09-04) : c'était une ghost
            feature sans comportement — soit fonctionnel, soit absent. Une
            vraie sauvegarde locale (localStorage + vue dédiée) est au backlog. */}

        <h1 className="t-d1 detail__title">{displayTitle(job.title)}</h1>
        {meta && <p className="t-body2 muted detail__meta">{meta}</p>}
      </div>

      {/* Deux actions honnêtes (D18), la stratégique en tête : le bouton vert
          pousse le profil Catwalks (matching = objectif business) et ne promet
          JAMAIS de transmettre la candidature. Le lien direct vers l'annonce de
          l'employeur reste disponible, en bouton outline. */}
      <div className="detail__actions">
        <a
          className="btn btn--primary btn--lg"
          href="https://catwalks.io/inscription?utm_source=fashion-atlas&utm_medium=aggregator&utm_campaign=job-detail"
          target="_blank"
          rel="noopener noreferrer"
        >
          Matcher mon profil avec Catwalks <ArrowGlyph />
        </a>
        <a className="btn btn--lg" href={job.applyUrl} target="_blank" rel="noopener noreferrer">
          Voir l’offre chez {job.company} <OutGlyph />
        </a>
      </div>

      <p className="t-body2 muted detail__note">
        Un profil Catwalks vous fait matcher avec les Maisons qui recrutent votre profil.
      </p>

      <JobFacts job={job} contract={contract} salary={salary} />

      <div className="block">
        <span className="t-caption green">Description</span>
        {job.description ? (
          // Descriptions are stored as clean plain text (the pipeline strips
          // HTML at ingest); whitespace-pre-line keeps the source's line breaks
          // and never trusts third-party HTML.
          <div className="prose t-body whitespace-pre-line">{job.description}</div>
        ) : (
          <p className="t-body2 muted">
            Cette source ne fournit pas le texte de l’offre. Le bouton « Voir l’offre » mène
            à l’annonce complète chez l’employeur.
          </p>
        )}
      </div>
    </article>
  );
}
