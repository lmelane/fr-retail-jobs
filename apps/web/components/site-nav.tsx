import Link from 'next/link';
import { Briefcase, Building2 } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * The top-bar brand + nav, shared by the Offres and Entreprises pages so the
 * two can never diverge — the logo, the centered Offres/Entreprises links, and
 * their icons are defined once here. `active` underlines the current section.
 *
 * The pages that carry a search pill render it themselves below this nav; this
 * component is only the identity + navigation row.
 */
export function SiteNav({ active }: { active: 'offres' | 'entreprises' }) {
  return (
    <>
      <Link href="/" className="shrink-0" aria-label="Fashion Atlas — accueil">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/fashion-atlas-logo.svg" alt="Fashion Atlas" className="block h-5 w-auto" />
      </Link>

      <nav className="order-3 flex w-full items-center justify-center gap-8 lg:order-none lg:w-auto lg:flex-1">
        <NavLink href="/emplois" icon={<Briefcase className="size-[17px]" aria-hidden />} active={active === 'offres'}>
          Offres
        </NavLink>
        <NavLink
          href="/entreprises"
          icon={<Building2 className="size-[17px]" aria-hidden />}
          active={active === 'entreprises'}
        >
          Entreprises
        </NavLink>
      </nav>
    </>
  );
}

function NavLink({
  href,
  icon,
  active,
  children,
}: {
  href: string;
  icon: React.ReactNode;
  active: boolean;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      aria-current={active ? 'page' : undefined}
      className={cn(
        '-mb-[13px] flex items-center gap-2 pb-3 text-[14px] font-normal tracking-[0.4px] transition-colors duration-300 ease-catwalks',
        active
          ? 'text-foreground border-foreground border-b-2'
          : 'text-foreground/60 hover:text-foreground',
      )}
    >
      {icon}
      {children}
    </Link>
  );
}
