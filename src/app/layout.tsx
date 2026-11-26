import type { Metadata, Viewport } from 'next';
import { ThemeProvider } from '@/components/ThemeProvider';
import './globals.css';

export const metadata: Metadata = {
  metadataBase: new URL('https://movehome.org'),
  title: 'MoveHome.org — The Non-Profit Behind RAIA Protocol',
  description: 'Move Home Organisation CIC (Co. No. 17202438) is a UK Community Interest Company. Asset-locked, mission-bound.',
  alternates: {
    canonical: 'https://movehome.org',
  },
  robots: {
    index: true,
    follow: true,
  },
  openGraph: {
    title: 'MoveHome.org — The Non-Profit Behind RAIA Protocol',
    description: 'Move Home Organisation CIC (Co. No. 17202438) is a UK Community Interest Company. Asset-locked, mission-bound.',
    url: 'https://movehome.org',
    siteName: 'MoveHome.org',
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'MoveHome.org — The Non-Profit Behind RAIA Protocol',
    description: 'Move Home Organisation CIC (Co. No. 17202438) is a UK Community Interest Company. Asset-locked, mission-bound.',
  },
  icons: {
    icon: '/branding/icon.svg',
  },
  manifest: '/manifest.json',
};

// Full-viewport deck on mobile: cover-safe 100dvh, no pinch-zoom surprises.
export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  themeColor: '#0A0F0D',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="min-h-screen antialiased">
        <ThemeProvider attribute="class" defaultTheme="light" enableSystem={true}>
          {children}
        </ThemeProvider>
      </body>
    </html>
  );
}
