import React, { useEffect, useRef, useState } from 'react'
import type { Page } from '../db/repo'
import {
  localId,
  normalizeSchema,
  type PropertyDef,
  type PropertyType,
  type RollupFn,
} from '../lib/database'

const PROPERTY_TYPES: { value: PropertyType; label: string }[] = [
  { value: 'text', label: 'Text' },
  { value: 'number', label: 'Number' },
  { value: 'select', label: 'Select' },
  { value: 'multi-select', label: 'Multi-select' },
  { value: 'date', label: 'Date' },
  { value: 'checkbox', label: 'Checkbox' },
  { value: 'url', label: 'URL' },
  { value: 'relation', label: 'Relation' },
  { value: 'rollup', label: 'Rollup' },
  { value: 'formula', label: 'Formula' },
  { value: 'person', label: 'Person' },
  { value: 'files', label: 'Files & media' },
  { value: 'created-time', label: 'Created time' },
  { value: 'last-edited-time', label: 'Last edited time' },
  { value: 'created-by', label: 'Created by' },
  { value: 'last-edited-by', label: 'Last edited by' },
]
const ROLLUP_FNS: RollupFn[] = ['show', 'count', 'sum', 'avg', 'min', 'max']

/**
 * Anchored popover replacing the window.prompt() property wizard
 * (critique P0). Native controls, conditional fields, inline validation —
 * nothing silently aborts, and Escape / outside-click dismiss.
 */
export function AddPropertyPopover({
  currentPageId,
  pages,
  existingRelations,
  onSubmit,
  onClose,
}: {
  currentPageId: string
  pages: Page[]
  /** relation properties already on THIS database, for rollup wiring. */
  existingRelations: PropertyDef[]
  onSubmit: (def: PropertyDef) => void
  onClose: () => void
}) {
  const ref = useRef<HTMLDivElement>(null)
  const nameRef = useRef<HTMLInputElement>(null)
  const [name, setName] = useState('')
  const [type, setType] = useState<PropertyType>('text')
  const [options, setOptions] = useState('Todo, Doing, Done')
  const [relationTarget, setRelationTarget] = useState('')
  const [rollupRelation, setRollupRelation] = useState(existingRelations[0]?.id ?? '')
  const [rollupProperty, setRollupProperty] = useState('title')
  const [rollupFn, setRollupFn] = useState<RollupFn>('show')
  const [formula, setFormula] = useState('')
  const [error, setError] = useState<string | null>(null)

  const databases = pages.filter((p) => p.is_database && p.id !== currentPageId)

  useEffect(() => {
    nameRef.current?.focus()
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose()
    }
    document.addEventListener('keydown', onKey)
    // Defer so the opening click doesn't immediately close it.
    const id = window.setTimeout(() => document.addEventListener('mousedown', onClick), 0)
    return () => {
      document.removeEventListener('keydown', onKey)
      document.removeEventListener('mousedown', onClick)
      window.clearTimeout(id)
    }
  }, [onClose])

  // Target-database property list for rollup (Title + that db's own props).
  const rollupTargetProps = (() => {
    const rel = existingRelations.find((r) => r.id === rollupRelation)
    const targetDb = pages.find((p) => p.id === rel?.relationTarget)
    const schema = targetDb?.db_schema ? normalizeSchema(targetDb.db_schema) : null
    return [{ id: 'title', name: 'Title' }, ...(schema?.properties ?? [])]
  })()

  const submit = () => {
    const trimmed = name.trim()
    if (!trimmed) {
      setError('Name is required.')
      return
    }
    const def: PropertyDef = { id: localId('prop'), name: trimmed, type }
    if (type === 'select' || type === 'multi-select') {
      def.options = options.split(',').map((s) => s.trim()).filter(Boolean)
      if (def.options.length === 0) {
        setError('Add at least one option.')
        return
      }
    }
    if (type === 'relation') {
      if (!relationTarget) {
        setError('Choose a target database.')
        return
      }
      def.relationTarget = relationTarget
    }
    if (type === 'rollup') {
      if (!rollupRelation) {
        setError('Choose a relation to roll up through.')
        return
      }
      def.rollupRelation = rollupRelation
      def.rollupProperty = rollupProperty
      def.rollupFn = rollupFn
    }
    if (type === 'formula') {
      if (!formula.trim()) {
        setError('Enter a formula, for example [Price] * [Qty].')
        return
      }
      def.formula = formula.trim()
    }
    onSubmit(def)
  }

  return (
    <div ref={ref} className="prop-popover" role="dialog" aria-label="Add property">
      <label className="prop-field">
        <span>Name</span>
        <input
          ref={nameRef}
          value={name}
          onChange={(e) => {
            setName(e.target.value)
            setError(null)
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') submit()
          }}
          placeholder="Property name"
        />
      </label>

      <label className="prop-field">
        <span>Type</span>
        <select value={type} onChange={(e) => setType(e.target.value as PropertyType)}>
          {PROPERTY_TYPES.map((t) => (
            <option key={t.value} value={t.value}>
              {t.label}
            </option>
          ))}
        </select>
      </label>

      {(type === 'select' || type === 'multi-select') && (
        <label className="prop-field">
          <span>Options</span>
          <input
            value={options}
            onChange={(e) => setOptions(e.target.value)}
            placeholder="Comma-separated"
          />
        </label>
      )}

      {type === 'relation' && (
        <label className="prop-field">
          <span>Target database</span>
          {databases.length === 0 ? (
            <span className="prop-note">No other database pages exist yet.</span>
          ) : (
            <select value={relationTarget} onChange={(e) => setRelationTarget(e.target.value)}>
              <option value="">Choose…</option>
              {databases.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.title || 'Untitled'}
                </option>
              ))}
            </select>
          )}
        </label>
      )}

      {type === 'rollup' &&
        (existingRelations.length === 0 ? (
          <p className="prop-note">Add a relation property first — rollups aggregate through one.</p>
        ) : (
          <>
            <label className="prop-field">
              <span>Through relation</span>
              <select value={rollupRelation} onChange={(e) => setRollupRelation(e.target.value)}>
                {existingRelations.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="prop-field">
              <span>Roll up property</span>
              <select value={rollupProperty} onChange={(e) => setRollupProperty(e.target.value)}>
                {rollupTargetProps.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="prop-field">
              <span>Aggregate</span>
              <select value={rollupFn} onChange={(e) => setRollupFn(e.target.value as RollupFn)}>
                {ROLLUP_FNS.map((f) => (
                  <option key={f} value={f}>
                    {f}
                  </option>
                ))}
              </select>
            </label>
          </>
        ))}

      {type === 'formula' && (
        <label className="prop-field">
          <span>Expression</span>
          <input
            value={formula}
            onChange={(event) => setFormula(event.target.value)}
            placeholder="[Price] * [Qty]"
          />
        </label>
      )}

      {error && <p className="prop-error">{error}</p>}

      <div className="prop-actions">
        <button className="prop-cancel" onClick={onClose}>
          Cancel
        </button>
        <button
          className="prop-submit"
          onClick={submit}
          disabled={type === 'rollup' && existingRelations.length === 0}
        >
          Add
        </button>
      </div>
    </div>
  )
}
