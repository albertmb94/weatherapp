'use client'

import { useState, useRef, useEffect } from 'react'
import type { WeatherModel } from '@/lib/models'

interface ModelSelectorProps {
  models: WeatherModel[]
  selected: string[]
  onChange: (ids: string[]) => void
  ensembleMode?: 'wedai' | 'models'
  onEnsembleModeChange?: (mode: 'wedai' | 'models') => void
}

export default function ModelSelector({ models, selected, onChange, ensembleMode = 'wedai', onEnsembleModeChange }: ModelSelectorProps) {
  const [dropdownOpen, setDropdownOpen] = useState(false)
  const dropdownRef = useRef<HTMLDivElement | null>(null)

  const allSelected = selected.length === models.length
  const singleModel = !allSelected && selected.length === 1
    ? models.find(m => m.id === selected[0])
    : null

  const dropdownLabel = allSelected ? 'All' : singleModel ? singleModel.label.split(' ')[0] : `${selected.length} models`

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setDropdownOpen(false)
      }
    }
    if (dropdownOpen) {
      document.addEventListener('mousedown', handleClickOutside)
      return () => document.removeEventListener('mousedown', handleClickOutside)
    }
  }, [dropdownOpen])

  function selectOnly(id: string) {
    if (selected.length === 1 && selected.includes(id)) {
      onChange(models.map(m => m.id))
    } else {
      onChange([id])
    }
    setDropdownOpen(false)
  }

  function selectAll() {
    onChange(models.map(m => m.id))
    setDropdownOpen(false)
  }

  return (
    <div className="mb-3 animate-fadeIn">
      {/* WedAI / Models toggle + dropdown */}
      <div className="flex items-center gap-1 mb-2">
        <button
          type="button"
          onClick={() => onEnsembleModeChange?.('wedai')}
          className={`px-3 py-1 rounded-full text-[11px] font-semibold cursor-pointer transition-colors min-h-[28px] border ${
            ensembleMode === 'wedai'
              ? 'bg-accent text-white border-accent'
              : 'bg-surface-popover text-text-secondary border-border hover:text-text-primary'
          }`}
        >
          WedAI
        </button>
        <button
          type="button"
          onClick={() => onEnsembleModeChange?.('models')}
          className={`px-3 py-1 rounded-full text-[11px] font-semibold cursor-pointer transition-colors min-h-[28px] border ${
            ensembleMode === 'models'
              ? 'bg-accent text-white border-accent'
              : 'bg-surface-popover text-text-secondary border-border hover:text-text-primary'
          }`}
        >
          Models
        </button>


        {/* Model dropdown (only visible in 'models' mode) */}
        {ensembleMode === 'models' && (
          <div className="relative" ref={dropdownRef}>
            <button
              type="button"
              onClick={() => setDropdownOpen(!dropdownOpen)}
              className="px-3 py-1 rounded-full text-[11px] font-semibold cursor-pointer transition-colors min-h-[28px] border bg-surface-popover text-text-secondary border-border hover:text-text-primary flex items-center gap-1.5"
            >
              <span>{dropdownLabel}</span>
              <svg className={`w-3 h-3 transition-transform ${dropdownOpen ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
              </svg>
            </button>

            {dropdownOpen && (
              <div className="absolute z-50 mt-1 left-0 min-w-[180px] bg-surface-popover border border-border rounded-lg shadow-lg py-1 max-h-[320px] overflow-y-auto">
                <button
                  type="button"
                  onClick={selectAll}
                  className={`w-full text-left px-3 py-1.5 text-[11px] font-medium cursor-pointer transition-colors ${
                    allSelected
                      ? 'text-accent bg-accent/10'
                      : 'text-text-secondary hover:bg-surface-hover hover:text-text-primary'
                  }`}
                >
                  All
                </button>
                <div className="border-t border-border my-0.5" />
                {models.map(m => {
                  const active = selected.includes(m.id)
                  return (
                    <button
                      key={m.id}
                      type="button"
                      onClick={() => selectOnly(m.id)}
                      className={`w-full text-left px-3 py-1.5 text-[11px] font-medium cursor-pointer transition-colors flex items-center gap-2 ${
                        active
                          ? 'text-text-primary bg-accent/10'
                          : 'text-text-secondary hover:bg-surface-hover hover:text-text-primary'
                      }`}
                    >
                      <span
                        className="w-2 h-2 rounded-full inline-block shrink-0"
                        style={{ backgroundColor: m.color }}
                      />
                      <span>{m.label}</span>
                    </button>
                  )
                })}
              </div>
            )}
          </div>
        )}
      </div>

      {/* WedAI info (only visible in 'wedai' mode) */}
      {ensembleMode === 'wedai' && (
        <div className="text-[10px] text-text-muted px-1">
          Ensemble optimizado: Temperatura + Precipitación + Detección lluvia
        </div>
      )}
    </div>
  )
}
