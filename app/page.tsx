import { Suspense } from 'react'
import HomeContent from './home-content'

export default function Home() {
  return (
    <Suspense fallback={<LoadingShell />}>
      <HomeContent />
    </Suspense>
  )
}

function LoadingShell() {
  return (
    <div className="h-screen flex flex-col bg-gray-950 text-white">
      <header className="px-3 py-2 bg-gray-900 border-b border-gray-800">
        <div className="flex items-center gap-2">
          <div className="h-5 w-24 bg-gray-800 rounded animate-pulse" />
          <div className="h-8 w-44 bg-gray-800 rounded animate-pulse" />
          <div className="h-8 w-40 bg-gray-800 rounded animate-pulse" />
        </div>
      </header>
      <div className="flex-1 flex items-center justify-center">
        <div className="w-6 h-6 border-2 border-gray-600 border-t-blue-500 rounded-full animate-spin" />
      </div>
    </div>
  )
}
