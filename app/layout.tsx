import type { Metadata, Viewport } from 'next';
import PwaRegister from '@/components/PwaRegister';
import './globals.css';

export const metadata: Metadata = {
  title: 'Bambu Dashboard',
  description: 'Live status of your Bambu Lab printer',
  applicationName: 'Bambu Dashboard',
  appleWebApp: { capable: true, title: 'Bambu', statusBarStyle: 'black-translucent' },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#f4f4f1' },
    { media: '(prefers-color-scheme: dark)', color: '#111315' },
  ],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        {children}
        <PwaRegister />
      </body>
    </html>
  );
}
