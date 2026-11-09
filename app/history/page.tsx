import type { Metadata } from 'next';
import HistoryView from '@/components/HistoryView';

export const metadata: Metadata = { title: 'History · Bambu Dashboard' };

export default function HistoryPage() {
  return <HistoryView />;
}
