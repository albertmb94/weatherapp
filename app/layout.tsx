import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import Providers from "./providers";
import ErrorBoundary from "@/components/ErrorBoundary";
import ConnectionStatus from "@/components/ConnectionStatus";
import ConsentBanner from "@/components/ConsentBanner";
import ConsentSync from "@/components/ConsentSync";
import AnalyticsTracker from "@/components/AnalyticsTracker";
import { getFeature } from "@/lib/features";
import { CONSENT_CHANGE_EVENT } from "@/lib/trackingConsent";
import { appOrigin } from "@/lib/appUrl";
import { headers } from "next/headers";
import { DEFAULT_LOCALE, LOCALE_HEADER, isLocale } from "@/lib/locale/routing";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const SITE_NAME = "Weather Model Comparison";
const SITE_DESCRIPTION =
  "Compara varios modelos meteorológicos a la vez y mira cuál acierta más en tu ciudad.";

/**
 * AUDITORÍA — la superficie SEO era CERO: sin `metadataBase`, sin
 * `openGraph`, sin `twitter`, sin canonical, sin sitemap y sin robots.
 * Compartir un enlace en WhatsApp o en redes no mostraba ni título ni
 * descripción, y los buscadores no tenían por dónde empezar.
 *
 * `metadataBase` sólo se fija cuando hay origen configurado: con un
 * valor inventado, Next generaría URLs absolutas apuntando al host
 * equivocado, que es peor que no generarlas.
 */
const origin = appOrigin();

export const metadata: Metadata = {
  ...(origin ? { metadataBase: new URL(origin) } : {}),
  // El título, la descripción, el canonical y los `hreflang` dependen del
  // idioma, así que viven en app/[locale]/layout.tsx, que es quien lo
  // conoce. Aquí queda sólo lo común a todo el sitio (incluido /admin).
  // Título PLANO, sin `template`: el layout de idioma define su propio
  // par default+template, y tener los dos hacía que el default del hijo
  // pasara por la plantilla del padre y saliera
  // "Weather Model Comparison · Weather Model Comparison".
  // Esto es sólo el respaldo para lo que queda fuera de [locale] (/admin).
  title: SITE_NAME,
  description: SITE_DESCRIPTION,
  applicationName: SITE_NAME,
  manifest: "/manifest.json",
  robots: {
    index: true,
    follow: true,
  },
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "Weather",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#0a0a0a",
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // AUDITORÍA: `lang` estaba escrito a fuego como "es" y sólo se
  // corregía en un efecto de cliente (lib/LocaleContext.tsx), de modo que
  // TODO rastreador y TODO lector de pantalla veía español, también para
  // quien navegaba en inglés. Este layout está por encima del segmento
  // `[locale]` y no recibe params, así que el idioma llega por una
  // cabecera de petición que escribe el proxy. Ahora el HTML sale del
  // servidor ya con el idioma correcto.
  const requestHeaders = await headers()
  const headerLocale = requestHeaders.get(LOCALE_HEADER)
  const lang = isLocale(headerLocale) ? headerLocale : DEFAULT_LOCALE

  // Read once at request time so feature toggles in the admin are picked
  // up on the next page render. Both scripts are gated; default OFF.
  const plausible = await getFeature('feature.plausible')
  const cookiebot = await getFeature('feature.cookiebot')
  const plausibleDomain = typeof plausible.config.domain === 'string' ? plausible.config.domain : null
  const cookiebotId = typeof cookiebot.config.cbid === 'string' ? cookiebot.config.cbid : null

  return (
    <html
      lang={lang}
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <head>
        {/* AUDITORÍA — FOUC de tema: la clase `light` se aplicaba SÓLO en
            un efecto posterior a la hidratación (lib/ThemeContext.tsx), y
            globals.css no tiene fallback por `prefers-color-scheme`, así
            que quien usa el tema claro veía un destello oscuro en CADA
            carga. Este script corre antes del primer pintado y replica
            exactamente `resolveTheme()`: si ambos se desincronizan, el
            efecto de React corrige en cuanto hidrata. */}
        <script dangerouslySetInnerHTML={{ __html: "try{var p=localStorage.getItem('weather-theme');if(p!=='dark'&&p!=='light'&&p!=='auto')p='dark';var h=new Date().getHours();var t=p==='auto'?((h>=6&&h<18)?'light':'dark'):p;if(t==='light')document.documentElement.classList.add('light')}catch(e){}" }} />
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
        {/* Se monta SIEMPRE: con Cookiebot activo es el único escritor de
            `wthr_consent`, y sin él se autodesactiva. Antes, activar
            Cookiebot dejaba la cookie sin escribir para siempre y el
            proxy bloqueaba el 100% del tracking (causa raíz #1). */}
        <ConsentSync cookiebotEnabled={cookiebot.enabled} />
        {/* Emite pageviews por beacon. Se comprueba el consentimiento en
            cada emisión, así que montarlo siempre es seguro: sin
            'granted' no sale ni una petición. */}
        <AnalyticsTracker />
        {!cookiebot.enabled ? <ConsentBanner /> : null}
        {/* B-NBT-10: red de seguridad SIN React para el banner de
            consentimiento. Aunque la hidratación muera (chunk viejo en
            caché del SW, deploy a medias, error de JS), los botones
            Aceptar/Rechazar siguen funcionando: este delegador en fase
            de captura persiste la elección y elimina el diálogo. Es
            idempotente con el handler de React.

            EMITE `wthr:consent-change` IGUAL QUE writeConsentCookie, y no
            es un detalle: el banner es visible desde el HTML del
            servidor, así que en un móvil lento se puede pulsar ANTES de
            que ConsentBanner hidrate. En ese caso sólo corre este
            delegador; si no avisara, el tracker —ya montado— nunca se
            enteraría de que ahora hay permiso y la visita se perdería.
            Es justo el escenario para el que existe la red de seguridad,
            y sin esta línea la red dejaba pasar la mitad del trabajo. */}
        {!cookiebot.enabled ? (
          <script
            dangerouslySetInnerHTML={{
              __html: `document.addEventListener('click',function(e){var t=e.target;if(!t||!t.closest)return;var b=t.closest('[data-consent-choice]');if(!b)return;var v=b.getAttribute('data-consent-choice')==='accept'?'granted':'rejected';try{localStorage.setItem('wthr_consent',v);localStorage.setItem('wthr_consent_ts',String(Date.now()))}catch(_){}document.cookie='wthr_consent='+v+';max-age=31536000;path=/;samesite=lax';try{window.dispatchEvent(new CustomEvent('${CONSENT_CHANGE_EVENT}',{detail:v}))}catch(_){}var d=b.closest('[data-consent-dialog]');if(d)d.style.display='none'},true);`,
            }}
          />
        ) : null}
        <script
          dangerouslySetInnerHTML={{
            // The SW is served through `/api/sw` so the build-time
            // version stamp from `next.config.ts` is injected into the
            // served source (see `app/api/sw/route.ts`). Registering
            // with `{ scope: '/' }` is REQUIRED: sin él el scope por
            // defecto sería la carpeta del script (`/api/`) y el SW no
            // controlaría ninguna página (auditoría F3/B3). El header
            // `Service-Worker-Allowed` solo eleva el máximo permitido,
            // no cambia el scope por defecto.
            __html: `if('serviceWorker' in navigator){window.addEventListener('load',()=>{navigator.serviceWorker.register('/api/sw',{scope:'/'}).catch(()=>{})})}`,
          }}
        />
      </body>
    </html>
  );
}
