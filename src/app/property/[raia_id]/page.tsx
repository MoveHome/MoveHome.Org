import { redirect } from 'next/navigation';

// Legacy deep link — the stream lives at /p/[raia_id].
export default async function PropertyPage({ params }: { params: Promise<{ raia_id: string }> }) {
  const { raia_id } = await params;
  redirect(`/p/${raia_id}`);
}
