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
        {/* B-NBT-10: red de seguridad SIN React para el banner de
            consentimiento. Aunque la hidratación muera (chunk viejo en
            caché del SW, deploy a medias, error de JS), los botones
            Aceptar/Rechazar siguen funcionando: este delegador en fase
            de captura persiste la elección y elimina el diálogo. Es
            idempotente con el handler de React. */}
        {!cookiebot.enabled ? (
          <script
            dangerouslySetInnerHTML={{
              __html: `document.addEventListener('click',function(e){var t=e.target;if(!t||!t.closest)return;var b=t.closest('[data-consent-choice]');if(!b)return;var v=b.getAttribute('data-consent-choice')==='accept'?'granted':'rejected';try{localStorage.setItem('wthr_consent',v);localStorage.setItem('wthr_consent_ts',String(Date.now()))}catch(_){}document.cookie='wthr_consent='+v+';max-age=31536000;path=/;samesite=lax';var d=b.closest('[data-consent-dialog]');if(d)d.style.display='none'},true);`,
            }}
          />
        ) : null}
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
