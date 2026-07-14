import React from 'react'
import { createRoot } from 'react-dom/client'
import { createDb } from './db/db'
import { App } from './App'
import './styles.css'

const root = createRoot(document.getElementById('root')!)
root.render(<div className="boot">Opening your workspace…</div>)

// Persistent IndexedDB store in the desktop app / browser; the DB is a
// rebuildable cache — durability comes from the Markdown mirror (spec F5).
createDb('idb://opennote')
  .then((db) => {
    root.render(<App db={db} />)
  })
  .catch((err: unknown) => {
    console.error('Failed to open the local database', err)
    root.render(
      <div className="boot boot-error">
        Failed to open the local database: {String(err)}
      </div>,
    )
  })
