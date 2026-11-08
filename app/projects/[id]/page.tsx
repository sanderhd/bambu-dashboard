import type { Metadata } from 'next';
import ProjectView from '@/components/ProjectView';

export const metadata: Metadata = { title: 'Project · Bambu Dashboard' };

export default async function ProjectPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <ProjectView id={id} />;
}
