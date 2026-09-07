import type { Metadata } from 'next';
import { ThemeScript } from '@/components/ThemeToggle';
import './globals.css';

export const metadata: Metadata = {
  title: 'Bug Bounty Monitor',
  description:
    'Discover newly launched self-hosted bug bounty and vulnerability disclosure programs before they become widely known.',
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <ThemeScript />
      </head>
      <body>{children}</body>
    </html>
  );
}
