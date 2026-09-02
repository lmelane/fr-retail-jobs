'use client';

import { Building2, ExternalLink, Layers } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { contractLabel } from '@/lib/format';
import type { JobRow } from '@/lib/jobs';

/**
 * Offer detail, read in place.
 *
 * The description costs nothing extra: ATS APIs return it alongside the listing
 * (Greenhouse 6.7k characters, Ashby 20k, FashionJobs 4.9k), so the candidate
 * reads the full posting without leaving the page — and without us fetching it
 * per offer.
 */

const SOURCE_LABELS: Record<string, string> = {
  richemont: 'Richemont',
  kering: 'Kering',
  loreal: "L'Oréal",
  courir: 'Courir',
  lacoste: 'Lacoste',
  sephora: 'Sephora',
  puig: 'Puig',
  chanel: 'Chanel',
  lvmh: 'LVMH',
  wttj: 'Welcome to the Jungle',
  fashionjobs: 'FashionJobs',
  dior: 'Dior',
};

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

/**
 * The structured fields, when the source published them.
 *
 * Coverage genuinely varies — Pinpoint and WTTJ give salary bands, TalentView
 * gives remote policy and experience — so each row appears only when it has a
 * value. Printing "Salaire : non précisé" would fill the panel with absences.
 *
 * Rendered as a bordered "Détails de l'emploi" section (Indeed §3.10) rather
 * than a plain fact grid — contract and salary are passed in so the header
 * summary line and this section never disagree on how they're formatted.
 */
function JobFactsSection({
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
  // "unknown"/"non précisé" is a non-answer some ATS emit; don't print it.
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
    <section className="border-border mb-5 border-b pb-5">
      <h3 className="text-foreground mb-3 text-xl font-normal tracking-[0.4px]">Détails de l’emploi</h3>
      <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-2.5 text-sm">
        {facts.map(([label, value]) => (
          <div key={label} className="contents">
            <dt className="text-grey-400 tracking-[0.4px]">{label}</dt>
            <dd className="text-foreground font-normal tracking-[0.4px]">{value}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

export function JobDetail({ job }: { job: JobRow }) {
  const contract = contractLabel(job.contract);
  const salary = salaryLabel(job);

  return (
    <div key={job.id} className="flex h-full min-h-0 flex-col">
      {/* Indeed §3.10: 24/700 title, entreprise + lieu, salaire/type on one
          line (salary bold), action row, then bordered sections below. */}
      <div className="shrink-0 px-6 pt-6 pb-5">
        {/* Detail title: uppercase, weight 400 — larger than the list card
            (24-32px per the DA) since this is the focal point of the pane. */}
        <h2 className="text-foreground text-[28px] leading-9 font-normal tracking-[0.4px] uppercase">
          {job.title}
        </h2>

        <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-[15px]">
          <span className="text-grey-400 inline-flex items-center gap-1.5 text-[12px] tracking-[1px] uppercase">
            <Building2 className="text-grey-400 size-4" />
            {job.company}
          </span>
          {job.group && (
            <>
              <span className="text-border">•</span>
              <span className="text-grey-400 text-[12px] tracking-[1px] uppercase">{job.group}</span>
            </>
          )}
        </div>

        {job.city && <p className="text-foreground mt-1 text-[15px] tracking-[0.4px]">{job.city}</p>}

        {(salary || contract) && (
          <p className="mt-1 text-[15px] tracking-[0.4px]">
            {salary && <span className="text-foreground font-normal">{salary}</span>}
            {salary && contract && <span className="text-foreground"> - </span>}
            {contract && <span className="text-foreground">{contract}</span>}
          </p>
        )}

        {/* Two honest actions (decision D18), with the strategic one leading.
            The STRONG black button pushes the Catwalks profile — matching is the
            business goal — and never promises to forward the application. The
            direct link to the employer's own posting stays available, just as a
            quieter outline button: honest, but not the emphasis. */}
        <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
          <Button
            asChild
            className="bg-primary text-primary-foreground hover:bg-grey-600 h-11 rounded-full px-6 text-[15px] font-normal tracking-[0.4px] transition-colors duration-300 ease-catwalks"
          >
            <a
              href="https://catwalks.io/inscription?utm_source=fashion-atlas&utm_medium=aggregator"
              target="_blank"
              rel="noopener noreferrer"
            >
              Matcher mon profil avec Catwalks
            </a>
          </Button>

          <Button
            asChild
            variant="outline"
            className="border-foreground text-foreground hover:bg-foreground hover:text-primary-foreground h-11 rounded-full bg-transparent px-6 text-[15px] font-normal tracking-[0.4px] transition-colors duration-300 ease-catwalks"
          >
            <a href={job.applyUrl} target="_blank" rel="noopener noreferrer">
              Voir l’offre chez {job.company}
              <ExternalLink className="size-4" />
            </a>
          </Button>
        </div>

        {/* The promise, stated plainly under the buttons — no false transmission. */}
        <p className="text-grey-400 mt-2 text-[13px] tracking-[0.4px]">
          Un profil Catwalks vous fait matcher avec les Maisons qui recrutent votre profil.
        </p>

      </div>

      <Separator className="bg-border" />

      {/* Sticky detail: this offer's own content scrolls internally ONLY when
          it overflows the sticky container's max-height (a long description) —
          the container itself no longer owns a fixed height, so `overflow-y-auto`
          is a no-op until content actually exceeds it, exactly like Indeed. */}
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="px-6 py-5">
          {/* "Détails de l'emploi" — a bordered section, Indeed §3.10. */}
          <JobFactsSection job={job} contract={contract} salary={salary} />

          <div>
            <h3 className="text-foreground mb-3 text-xl font-normal tracking-[0.4px]">Description</h3>
            {job.description ? (
              // Descriptions are stored as clean plain text (the pipeline strips
              // HTML at ingest); whitespace-pre-line keeps the source's line
              // breaks and never trusts third-party HTML.
              <p className="max-w-[70ch] text-[15px] leading-7 tracking-[0.4px] whitespace-pre-line">
                {job.description}
              </p>
            ) : (
              <p className="text-grey-400 text-sm tracking-[0.4px]">
                Cette source ne fournit pas le texte de l’offre. Le bouton Postuler mène à
                l’annonce complète chez l’employeur.
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
