import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import Providers from "./providers";
import ErrorBoundary from "@/components/ErrorBoundary";
import ConnectionStatus from "@/components/ConnectionStatus";
import ConsentBanner from "@/components/ConsentBanner";
import { getFeature } from "@/lib/features";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Weather Model Comparison",
  description: "Compare multiple weather models side by side",
  manifest: "/manifest.json",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "Weather",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  themeColor: "#0a0a0a",
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // Read once at request time so feature toggles in the admin are picked
  // up on the next page render. Both scripts are gated; default OFF.
  const plausible = await getFeature('feature.plausible')
  const cookiebot = await getFeature('feature.cookiebot')
  const plausibleDomain = typeof plausible.config.domain === 'string' ? plausible.config.domain : null
  const cookiebotId = typeof cookiebot.config.cbid === 'string' ? cookiebot.config.cbid : null

  return (
    <html
      lang="es"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <head>
        <link rel="manifest" href="/manifest.json" />
        <link rel="apple-touch-icon" href="/icon-192.svg" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
        {plausible.enabled && plausibleDomain ? (
          <script
            defer
            data-domain={plausibleDomain}
            src="https://plausible.io/js/script.js"
          />
        ) : null}
        {cookiebot.enabled && cookiebotId ? (
          // eslint-disable-next-line @next/next/no-sync-scripts
          <script
            id="Cookiebot"
            src="https://consent.cookiebot.com/uc.js"
            data-cbid={cookiebotId}
            data-framework="TCF"
            type="text/javascript"
          />
        ) : null}
      </head>
      <body className="min-h-full flex flex-col">
        <ErrorBoundary>
          <ConnectionStatus />
          <Providers>{children}</Providers>
        </ErrorBoundary>
        {!cookiebot.enabled ? <ConsentBanner /> : null}
        <script
          dangerouslySetInnerHTML={{
            // The SW is served through `/api/sw` so the build-time
            // version stamp from `next.config.ts` is injected into the
            // served source (see `app/api/sw/route.ts`). Registering
            // with a path-based URL keeps the same scope (`/`) and lets
            // us add `Cache-Control: no-store` to the response.
            __html: `if('serviceWorker' in navigator){window.addEventListener('load',()=>{navigator.serviceWorker.register('/api/sw').catch(()=>{})})}`,
          }}
        />
      </body>
    </html>
  );
}
