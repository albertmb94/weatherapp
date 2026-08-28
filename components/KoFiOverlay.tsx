'use client'

/**
 * B-NBT-23: botón flotante de Ko-fi minimalista (solo desktop ≥1024px).
 * La URL viene de feature.kofi.url (gestionada en /admin/donations),
 * con fallback al perfil por defecto si el admin no la configuró.
 */
export default function KoFiOverlay({ url }: { url: string }) {
  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      aria-label="Apoya el proyecto en Ko-fi"
      className="hidden real-desktop:flex fixed bottom-4 right-4 z-[1500] w-12 h-12 rounded-full bg-[#323842] items-center justify-center shadow-lg hover:scale-105 transition-transform cursor-pointer"
    >
      {/* Ko-fi logo SVG inline */}
      <svg viewBox="0 0 24 24" className="w-6 h-6" fill="#fff" aria-hidden="true">
        <path d="M23.881 8.948c-.773-4.085-4.859-4.593-4.859-4.593.775-.484 1.599-1.33 1.599-2.354 0-.944-.508-1.764-1.27-2.228L19.36.001h-3.24l.036 2.406c-.384.06-.772.14-1.152.245C13.15 1.282 10.918.805 8.766.805c-4.02 0-7.474 2.228-7.474 2.228l1.984 2.056s1.752-.556 3.004-.556c0 0 .296 1.128-.372 2.32-.668 1.192-1.656 1.484-1.656 1.484l1.092 1.68s2.396-.52 4.116-.148c0 0 1.04 2.212 2.212 3.108 0 0 .076 1.344-.892 2.464 0 0 1.64 1.56 3.656 1.56s3.656-1.56 3.656-1.56c-.964-1.12-.888-2.464-.888-2.464 1.172-.896 2.208-3.104 2.208-3.104 1.72-.372 4.116.148 4.116.148z"/>
      </svg>
    </a>
  )
}
