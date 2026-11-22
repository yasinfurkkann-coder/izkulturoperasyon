import { getDatabase } from '@netlify/database'

const DOC_ID = 'takvim-2027'
const MAX_BODY_BYTES = 8 * 1024 * 1024

let dbPromise = null
function getDb() {
  if (!dbPromise) dbPromise = getDatabase()
  return dbPromise
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }
  })
}

async function readState() {
  const db = getDb()
  const rows = await db.sql`
    SELECT events_json, stamp_rate, users_json, note_text, updated_by, updated_at_ms
    FROM team_state
    WHERE doc_id = ${DOC_ID}
  `
  if (!rows || !rows.length) return { rev: 0, updatedAtMs: 0 }
  const r = rows[0]
  const rev = Number(r.updated_at_ms) || 0
  return {
    rev,
    updatedAtMs: rev,
    eventsJson: r.events_json,
    stampRate: r.stamp_rate == null ? null : Number(r.stamp_rate),
    usersJson: r.users_json,
    noteText: r.note_text,
    updatedBy: r.updated_by
  }
}

async function writeState(body) {
  const db = getDb()
  const eventsJson = typeof body.eventsJson === 'string' ? body.eventsJson : null
  const stampRate = typeof body.stampRate === 'number' && Number.isFinite(body.stampRate) ? body.stampRate : null
  const usersJson = typeof body.usersJson === 'string' ? body.usersJson : null
  const noteText = typeof body.noteText === 'string' ? body.noteText : null
  const updatedBy = typeof body.updatedBy === 'string' ? body.updatedBy.slice(0, 120) : null
  const updatedAtMs = Number.isFinite(body.updatedAtMs) ? Math.floor(Number(body.updatedAtMs)) : Date.now()

  const result = await db.sql`
    INSERT INTO team_state (doc_id, events_json, stamp_rate, users_json, note_text, updated_by, updated_at_ms)
    VALUES (${DOC_ID}, ${eventsJson}, ${stampRate}, ${usersJson}, ${noteText}, ${updatedBy}, ${updatedAtMs})
    ON CONFLICT (doc_id) DO UPDATE SET
      events_json = COALESCE(${eventsJson}, team_state.events_json),
      stamp_rate = COALESCE(${stampRate}, team_state.stamp_rate),
      users_json = COALESCE(${usersJson}, team_state.users_json),
      note_text = COALESCE(${noteText}, team_state.note_text),
      updated_by = COALESCE(${updatedBy}, team_state.updated_by),
      updated_at_ms = GREATEST(${updatedAtMs}, team_state.updated_at_ms)
    RETURNING updated_at_ms
  `
  const rev = Number(result?.[0]?.updated_at_ms ?? updatedAtMs) || updatedAtMs
  return { rev, updatedAtMs: rev, updatedBy }
}

export default async function handler(req) {
  const url = new URL(req.url)
  if (url.pathname !== '/api/state') {
    return json({ error: 'Not found' }, 404)
  }

  if (req.method === 'GET') {
    try {
      return json(await readState())
    } catch (err) {
      console.error('GET /api/state failed', err)
      return json({ error: 'Veritabanı hatası' }, 500)
    }
  }

  if (req.method === 'PUT') {
    const len = Number(req.headers.get('content-length') || 0)
    if (len > MAX_BODY_BYTES) return json({ error: 'İstek çok büyük' }, 413)
    let body
    try {
      body = await req.json()
    } catch {
      return json({ error: 'Geçersiz JSON' }, 400)
    }
    try {
      return json(await writeState(body || {}))
    } catch (err) {
      console.error('PUT /api/state failed', err)
      return json({ error: 'Veritabanı hatası' }, 500)
    }
  }

  return json({ error: 'Method not allowed' }, 405)
}

export const config = {
  path: '/api/*'
}
