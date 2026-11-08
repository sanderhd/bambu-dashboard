import type { Metadata } from 'next';
import ProjectsList from '@/components/ProjectsList';

export const metadata: Metadata = { title: 'Projects · Bambu Dashboard' };

export default function ProjectsPage() {
  return <ProjectsList />;
}
