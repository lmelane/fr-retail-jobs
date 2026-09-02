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
  if (job.sources.length > 0)
    facts.push([
      job.sources.length > 1 ? 'Sources' : 'Source',
      job.sources.map((source) => SOURCE_LABELS[source] ?? source).join(' · '),
    ]);

  if (facts.length === 0) return null;

  return (
    <section className="border-border mb-5 border-b pb-5">
      <h3 className="text-foreground mb-3 text-xl font-bold">Détails de l’emploi</h3>
      <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-2.5 text-sm">
        {facts.map(([label, value]) => (
          <div key={label} className="contents">
            <dt className="text-muted-foreground">{label}</dt>
            <dd className="text-foreground font-medium">{value}</dd>
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
        <h2 className="text-foreground text-2xl leading-8 font-bold">{job.title}</h2>

        <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-[15px]">
          <span className="text-foreground inline-flex items-center gap-1.5 font-medium">
            <Building2 className="text-muted-foreground size-4" />
            {job.company}
          </span>
          {job.group && (
            <>
              <span className="text-border">•</span>
              <span className="text-muted-foreground">{job.group}</span>
            </>
          )}
        </div>

        {job.city && <p className="text-foreground mt-1 text-[15px]">{job.city}</p>}

        {(salary || contract) && (
          <p className="mt-1 text-[15px]">
            {salary && <span className="text-foreground font-bold">{salary}</span>}
            {salary && contract && <span className="text-foreground"> - </span>}
            {contract && <span className="text-foreground">{contract}</span>}
          </p>
        )}

        <div className="mt-4 flex flex-wrap items-center gap-2">
          <Button asChild className="h-11 rounded-xl px-6 text-[15px] font-bold">
            <a href={job.applyUrl} target="_blank" rel="noopener noreferrer">
              Postuler
              <ExternalLink className="size-4" />
            </a>
          </Button>

          {/* The posting's own URL, so it can be sent to someone. */}
          <Button
            asChild
            variant="ghost"
            className="hover:bg-surface h-11 rounded-xl px-4 text-[15px] font-medium"
          >
            <a href={`/offre/${job.id}`}>Lien de l’offre</a>
          </Button>
        </div>

        {/* The differentiator, stated plainly: several sources agree on this one
            opening, and the link goes to the employer rather than a reposting. */}
        {job.sourceCount > 1 && (
          <p className="text-muted-foreground mt-3 flex items-center gap-1.5 text-xs tracking-[0.4px]">
            <Layers className="size-3.5 shrink-0" />
            Vue sur {job.sourceCount} sources
            <span className="opacity-70">
              ({job.sources.map((source) => SOURCE_LABELS[source] ?? source).join(' · ')})
            </span>
          </p>
        )}
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
            <h3 className="text-foreground mb-3 text-xl font-bold">Description</h3>
            {job.description ? (
              // Descriptions are stored as clean plain text (the pipeline strips
              // HTML at ingest); whitespace-pre-line keeps the source's line
              // breaks and never trusts third-party HTML.
              <p className="max-w-[70ch] text-[15px] leading-7 whitespace-pre-line">
                {job.description}
              </p>
            ) : (
              <p className="text-muted-foreground text-sm">
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
