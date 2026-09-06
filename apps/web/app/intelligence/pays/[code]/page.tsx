import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { IntelPage, JsonLd, PageHead } from '@/components/intelligence/chrome';
import { ProfileBlocks, ProfileFooter, ProfileKpis, ProfileSeries } from '@/components/intelligence/profile-view';
import { getProfile } from '@/lib/intelligence/queries/profile';
import { getCoverage } from '@/lib/intelligence/queries/coverage';
import { resolveCountry } from '@/lib/intelligence/queries/resolve';
import { fmtInt, MIN_SAMPLE } from '@/lib/intelligence/format';
import { intelPaths } from '@/lib/intelligence/paths';
import { breadcrumbLd, intelMetadata, webPageLd } from '@/lib/intelligence/seo';

export const dynamic = 'force-dynamic';

type Params = { params: Promise<{ code: string }> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const country = resolveCountry((await params).code);
  if (!country) return { title: 'Pays introuvable' };
  const profile = await getProfile({ country: country.code }, { snapshot: { scope: 'country', key: country.code } });
  const n = profile.headline.active;
  return intelMetadata({
    subject: `Recrutement luxe : ${country.label}`,
    description: `${fmtInt(n)} offres actives Mode, Luxe, Beauté, Horlogerie et Retail en ${country.label} : ${fmtInt(profile.headline.companies)} Maisons, ${fmtInt(profile.headline.cities)} villes, métiers, séniorité, contrats, concentration. Chiffres lus dans la base.`,
    path: intelPaths.country(country.code),
    noindex: n < MIN_SAMPLE,
  });
}

export default async function Page({ params }: Params) {
  const raw = (await params).code;
  const country = resolveCountry(raw);
  if (!country) notFound();
  const [profile, coverage] = await Promise.all([
    getProfile({ country: country.code }, { snapshot: { scope: 'country', key: country.code } }),
    getCoverage(),
  ]);
  if (profile.headline.active === 0) notFound();
  const path = intelPaths.country(country.code);
  const crumbs = [{ name: 'Intelligence', path: intelPaths.home }, { name: 'Géographies', path: intelPaths.geographies }, { name: country.label, path }];
  const description = `${fmtInt(profile.headline.active)} offres actives en ${country.label}.`;

  return (
    <IntelPage>
      <JsonLd data={webPageLd({ name: `Recrutement luxe en ${country.label}`, description, path, dateModified: coverage.updatedAt })} />
      <JsonLd data={breadcrumbLd(crumbs)} />
      <PageHead crumbs={crumbs} eyebrow="Pays" title={country.label} lede={<p>{fmtInt(profile.headline.active)} offres actives, {fmtInt(profile.headline.companies)} Maisons, {fmtInt(profile.headline.cities)} villes. Les parts et médianes sont calculées ; sous 30 offres elles s'affichent n/d.</p>} />

      <section className="container" style={{ paddingTop: 48 }}>
        <ProfileKpis profile={profile} coverage={coverage} ctx={{ kind: 'country', name: country.label, jobsParams: { pays: country.code } }} />
      </section>
      <section className="container" style={{ paddingTop: 64 }}>
        <ProfileSeries profile={profile} coverage={coverage} title={`Offres actives en ${country.label}, jour par jour.`} />
      </section>
      <section className="container" style={{ paddingTop: 64 }}>
        <ProfileBlocks profile={profile} ctx={{ kind: 'country', name: country.label, jobsParams: { pays: country.code } }} />
      </section>
      <ProfileFooter coverage={coverage} jobs={profile.headline.active} />
    </IntelPage>
  );
}
