import { JobsView } from '@/components/jobs-view';
import { getJobs } from '@/lib/jobs';

// Offers change through the day; revalidate rather than serving a stale build.
export const revalidate = 300;

export default async function Page() {
  return <JobsView data={await getJobs()} />;
}
