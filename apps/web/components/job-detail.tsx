'use client';

import { Building2, Clock, ExternalLink, Layers, MapPin, Briefcase } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { contractLabel, relativeDate } from '@/lib/format';
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
 */
function JobFacts({ job }: { job: JobRow }) {
  const facts: [string, string][] = [];
  const salary = salaryLabel(job);

  const contract = contractLabel(job.contract);
  if (contract) facts.push(['Contrat', contract]);
  if (salary) facts.push(['Salaire', salary]);
  const workingTime = contractLabel(job.workingTime);
  if (workingTime) facts.push(['Temps de travail', workingTime]);
  if (job.remote) facts.push(['Télétravail', job.remote]);
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
    <dl className="bg-surface mb-5 grid grid-cols-[auto_1fr] gap-x-6 gap-y-2 rounded-2xl px-4 py-3.5 text-sm">
      {facts.map(([label, value]) => (
        <div key={label} className="contents">
          <dt className="text-muted-foreground tracking-[0.25px]">{label}</dt>
          <dd className="text-foreground font-medium">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

export function JobDetail({ job }: { job: JobRow }) {
  return (
    <div key={job.id} className="flex h-full flex-col">
      <div className="shrink-0 px-6 pt-6 pb-4">
        <h2 className="text-2xl leading-8 font-normal">{job.title}</h2>

        <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm tracking-[0.1px]">
          <span className="inline-flex items-center gap-1.5 font-medium">
            <Building2 className="text-muted-foreground size-4" />
            {job.company}
          </span>
          {job.group && <span className="text-muted-foreground">{job.group}</span>}
        </div>

        <div className="text-muted-foreground mt-3 flex flex-wrap items-center gap-2 text-xs font-medium tracking-[0.5px]">
          {job.city && (
            <span className="bg-surface inline-flex items-center gap-1 rounded-full px-3 py-1.5">
              <MapPin className="size-3.5" />
              {job.city}
            </span>
          )}
          {contractLabel(job.contract) && (
            <span className="bg-surface inline-flex items-center gap-1 rounded-full px-3 py-1.5">
              <Briefcase className="size-3.5" />
              {contractLabel(job.contract)}
            </span>
          )}
          {job.postedAt && (
            <span className="bg-surface inline-flex items-center gap-1 rounded-full px-3 py-1.5">
              <Clock className="size-3.5" />
              {relativeDate(job.postedAt)}
            </span>
          )}
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-2">
          <Button asChild className="h-11 rounded-full px-6 text-sm font-medium tracking-[0.1px]">
            <a href={job.applyUrl} target="_blank" rel="noopener noreferrer">
              Postuler
              <ExternalLink className="size-4" />
            </a>
          </Button>

          {/* The posting's own URL, so it can be sent to someone. */}
          <Button
            asChild
            variant="ghost"
            className="hover:bg-surface h-11 rounded-full px-4 text-sm font-medium"
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

      <Separator className="bg-border/60" />

      <ScrollArea className="min-h-0 flex-1">
        <div className="px-6 py-5">
          <JobFacts job={job} />
          {job.description ? (
            // Descriptions are stored as clean plain text (the pipeline strips
            // HTML at ingest); whitespace-pre-line keeps the source's line breaks
            // and never trusts third-party HTML.
            <p className="max-w-[70ch] text-[15px] leading-7 tracking-[0.25px] whitespace-pre-line">
              {job.description}
            </p>
          ) : (
            <p className="text-muted-foreground text-sm tracking-[0.25px]">
              Cette source ne fournit pas le texte de l’offre. Le bouton Postuler mène à
              l’annonce complète chez l’employeur.
            </p>
          )}
        </div>
      </ScrollArea>
    </div>
  );
}
