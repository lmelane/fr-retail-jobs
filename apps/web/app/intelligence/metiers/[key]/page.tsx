import { getOccupationPresentation } from '@/lib/occupations';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { IntelPage, JsonLd, PageHead } from '@/components/intelligence/chrome';
import { ProfileBlocks, ProfileFooter, ProfileKpis, ProfileSeries } from '@/components/intelligence/profile-view';
import { getProfile } from '@/lib/intelligence/queries/profile';
import { getCoverage } from '@/lib/intelligence/queries/coverage';
import { fmtInt, MIN_SAMPLE } from '@/lib/intelligence/format';
import { intelPaths } from '@/lib/intelligence/paths';
import { breadcrumbLd, intelMetadata, webPageLd } from '@/lib/intelligence/seo';


export const dynamic = 'force-dynamic';

type Params = { params: Promise<{ key: string }> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const {taxonomy,FUNCTION_BY_KEY,FAMILY_LABELS}=await getOccupationPresentation();
  const key=(await params).key;
  const occupation=taxonomy.occupations.get(key);
  const def=occupation?{key:occupation.key,label:occupation.labels.fr,family:taxonomy.families.get(occupation.family!)!.group!}:FUNCTION_BY_KEY.get(key);
  if (!def) return { title: 'Métier introuvable' };
  const profile = await getProfile(occupation?{occupation:def.key}:{fn:def.key}, {snapshot:{scope:occupation?'occupation':'function',key:def.key},skills:true});
  const n = profile.headline.active;
  return intelMetadata({
    subject: `${def.label} : la demande mondiale`,
    description: `${fmtInt(n)} offres actives « ${def.label} » (${FAMILY_LABELS[def.family]}) dans le luxe, la mode, la beauté et le retail : top pays, villes, employeurs, séniorité, contrats, compétences associées.`,
    path: intelPaths.fn(def.key),
    noindex: n < MIN_SAMPLE,
  });
}

export default async function Page({ params }: Params) {
  const {taxonomy,JOB_FUNCTIONS,FUNCTION_BY_KEY,FAMILY_LABELS,functionLabel}=await getOccupationPresentation();
  const key=(await params).key;
  const occupation=taxonomy.occupations.get(key);
  const def=occupation?{key:occupation.key,label:occupation.labels.fr,family:taxonomy.families.get(occupation.family!)!.group!}:FUNCTION_BY_KEY.get(key);
  if (!def) notFound();
  const [profile, coverage] = await Promise.all([
    getProfile(occupation?{occupation:def.key}:{fn:def.key}, {snapshot:{scope:occupation?'occupation':'function',key:def.key},skills:true}),
    getCoverage(),
  ]);
  const path = intelPaths.fn(def.key);
  const crumbs = [{ name: 'Intelligence', path: intelPaths.home }, { name: 'Métiers', path: intelPaths.functions }, { name: def.label, path }];
  const ctx = { kind: 'function' as const, name: def.label, jobsParams: occupation?{metier:def.key}:{fonction:def.key} };

  return (
    <IntelPage>
      <JsonLd data={webPageLd({ name: `${def.label} — demande mondiale`, description: `${fmtInt(profile.headline.active)} offres actives.`, path, dateModified: coverage.updatedAt })} />
      <JsonLd data={breadcrumbLd(crumbs)} />
      <PageHead
        crumbs={crumbs}
        eyebrow={`Métier · ${FAMILY_LABELS[def.family]}`}
        title={def.label}
        lede={
          profile.headline.active > 0 ? (
            <p>{fmtInt(profile.headline.active)} offres actives dans le monde, {fmtInt(profile.headline.companies)} Maisons, {fmtInt(profile.countriesTotal)} pays. Classification par règles à l'écriture ; la couverture est affichée sur la page Métiers.</p>
          ) : (
            <p>Aucune offre active n'est classée « {def.label} » pour l'instant. La classification tourne à chaque ingest : cette page se remplira d'elle-même.</p>
          )
        }
      />

      <section className="container" style={{ paddingTop: 48 }}>
        <ProfileKpis profile={profile} coverage={coverage} ctx={ctx} />
      </section>
      {profile.headline.active > 0 && (
        <>
          <section className="container" style={{ paddingTop: 64 }}>
            <ProfileSeries profile={profile} coverage={coverage} title={`Offres actives « ${def.label} », jour par jour.`} />
          </section>
          <section className="container" style={{ paddingTop: 64 }}>
            <ProfileBlocks profile={profile} ctx={ctx} />
          </section>
        </>
      )}
      <ProfileFooter coverage={coverage} jobs={profile.headline.active} />
    </IntelPage>
  );
}
