import type { Metadata } from 'next';
import StatsView from '@/components/StatsView';

export const metadata: Metadata = { title: 'Stats · Bambu Dashboard' };

export default function StatsPage() {
  return <StatsView />;
}
