'use client'

export function DailySummarySkeleton() {
  return (
    <div className="mb-3 animate-pulse">
      <div className="h-4 w-40 bg-gray-800 rounded mb-2" />
      <div className="grid grid-cols-7 gap-1">
        {Array.from({ length: 7 }).map((_, i) => (
          <div key={i} className="px-1 py-1.5 rounded border border-gray-800 bg-gray-900/60">
            <div className="h-3 w-8 bg-gray-800 rounded mx-auto mb-1" />
            <div className="h-6 w-6 bg-gray-800 rounded mx-auto my-0.5" />
            <div className="flex justify-center gap-0.5">
              <div className="h-3 w-6 bg-gray-800 rounded" />
              <div className="h-3 w-4 bg-gray-800 rounded" />
            </div>
            <div className="mt-1 flex justify-center gap-1">
              <div className="h-2.5 w-6 bg-gray-800 rounded" />
              <div className="h-2.5 w-6 bg-gray-800 rounded" />
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

export function ChartSkeleton() {
  return (
    <div className="animate-pulse">
      <div className="h-4 w-48 bg-gray-800 rounded mb-2" />
      <div className="h-56 sm:h-64 w-full bg-gray-900/40 rounded-lg flex items-end px-4 pb-4 gap-1">
        {Array.from({ length: 24 }).map((_, i) => (
          <div
            key={i}
            className="flex-1 bg-gray-800 rounded-t"
            style={{ height: `${20 + ((i * 17 + 13) % 60)}%` }}
          />
        ))}
      </div>
    </div>
  )
}

export function InsightsSkeleton() {
  return (
    <div className="mb-4 animate-pulse">
      <div className="flex items-center justify-between mb-2">
        <div className="h-4 w-20 bg-gray-800 rounded" />
        <div className="flex gap-0.5">
          {['1h', '2h', '3h', '4h', '6h', '12h', '1d'].map(b => (
            <div key={b} className="h-7 w-8 bg-gray-800 rounded" />
          ))}
        </div>
      </div>
      <div className="rounded border border-gray-800 overflow-hidden">
        <div className="h-8 bg-gray-900" />
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="h-8 border-t border-gray-800/60 bg-gray-900/30" />
        ))}
      </div>
    </div>
  )
}
