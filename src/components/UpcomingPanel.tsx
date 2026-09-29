import { useState } from 'react'
import type { Booking, Room, Settings } from '../lib/types'
import { minutesToLabel, shortDate, todayYmd, utcToZoned, weekdayShort, addDays } from '../lib/time'
import { cancelBooking } from '../lib/bookings'
import { ConfirmDialog } from './ui'

interface Props {
  items: Booking[]
  rooms: Room[]
  settings: Settings
  loading: boolean
  onOpenDay: (ymd: string) => void
  onCancelled: (message: string) => void
}

export function UpcomingPanel({ items, rooms, settings, loading, onOpenDay, onCancelled }: Props) {
  const [target, setTarget] = useState<Booking | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const tz = settings.timezone
  const today = todayYmd(tz)
  const tomorrow = addDays(today, 1)

  function dayLabel(ymd: string) {
    if (ymd === today) return 'Hoje'
    if (ymd === tomorrow) return 'Amanhã'
    return `${weekdayShort(ymd)}, ${shortDate(ymd)}`
  }

  async function confirm() {
    if (!target) return
    setBusy(true)
    setError(null)
    const err = await cancelBooking(target.id)
    setBusy(false)
    if (err) return setError(err)
    setTarget(null)
    onCancelled('Reserva cancelada.')
  }

  const roomName = (id: string) => rooms.find((r) => r.id === id)?.name ?? '—'

  return (
    <aside className="card side" aria-labelledby="upcoming-title">
      <div className="side-head">
        <h3 id="upcoming-title">Suas próximas reservas</h3>
      </div>
      {loading && items.length === 0 ? (
        <div className="side-empty">Carregando…</div>
      ) : items.length === 0 ? (
        <div className="side-empty">Você não tem reservas futuras. Clique num horário livre da grade para reservar.</div>
      ) : (
        <ul className="upcoming">
          {items.map((b) => {
            const s = utcToZoned(new Date(b.starts_at), tz)
            const e = utcToZoned(new Date(b.ends_at), tz)
            return (
              <li key={b.id}>
                <button
                  className="up-when btn-ghost"
                  style={{ border: 0, padding: 0, background: 'none', cursor: 'pointer', textAlign: 'left' }}
                  onClick={() => onOpenDay(s.ymd)}
                  title="Ver na grade"
                >
                  {dayLabel(s.ymd)} · {minutesToLabel(s.minutes)}–{minutesToLabel(e.minutes)}
                </button>
                <div className="up-subject">{b.subject}</div>
                <div className="up-room">{roomName(b.room_id)}</div>
                <div className="up-actions">
                  <button className="btn btn-sm btn-danger" onClick={() => { setError(null); setTarget(b) }}>
                    Cancelar
                  </button>
                </div>
              </li>
            )
          })}
        </ul>
      )}

      {target && (
        <ConfirmDialog
          title="Cancelar reserva?"
          message={
            <>
              <strong>{target.subject}</strong>
              <br />
              <span className="muted">
                {roomName(target.room_id)} · {dayLabel(utcToZoned(new Date(target.starts_at), tz).ymd)},{' '}
                {minutesToLabel(utcToZoned(new Date(target.starts_at), tz).minutes)}–
                {minutesToLabel(utcToZoned(new Date(target.ends_at), tz).minutes)}
              </span>
            </>
          }
          confirmLabel="Sim, cancelar"
          busy={busy}
          error={error}
          onConfirm={confirm}
          onCancel={() => setTarget(null)}
        />
      )}
    </aside>
  )
}
