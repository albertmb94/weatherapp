'use client'

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
