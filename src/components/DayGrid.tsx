import type { Booking, Room, Settings } from '../lib/types'
import { minutesToLabel, timeToMinutes, utcToZoned } from '../lib/time'

interface Props {
  day: string
  todayYmd: string
  nowMinutes: number
  rooms: Room[]
  bookings: Booking[]
  settings: Settings
  meId: string
  onSlotClick: (roomId: string, startMinutes: number, endMinutes: number) => void
  onBookingClick: (b: Booking) => void
}

export function DayGrid({ day, todayYmd, nowMinutes, rooms, bookings, settings, meId, onSlotClick, onBookingClick }: Props) {
  const open = timeToMinutes(settings.open_time)
  const close = timeToMinutes(settings.close_time)
  const step = settings.slot_minutes
  const slots: number[] = []
  for (let m = open; m < close; m += step) slots.push(m)

  const isToday = day === todayYmd
  const isPastDay = day < todayYmd
  // posições em "número de blocos", convertidas em px pelo CSS (--slot-h muda no celular)
  const at = (minutes: number, extraPx = 0) => `calc(var(--slot-h) * ${(minutes - open) / step} + ${extraPx}px)`
  const span = (minutes: number, extraPx = 0) => `calc(var(--slot-h) * ${minutes / step} + ${extraPx}px)`
  const showNow = isToday && nowMinutes >= open && nowMinutes <= close
  const nowTop = at(nowMinutes)

  if (rooms.length === 0) {
    return <div className="grid-scroll"><div className="empty-rooms">Nenhuma sala cadastrada ainda.</div></div>
  }

  return (
    <div className="grid-scroll" role="region" aria-label="Grade de horários do dia" tabIndex={0}>
      <div
        className="grid"
        style={{ gridTemplateColumns: `var(--time-w) repeat(${rooms.length}, minmax(148px, 1fr))` }}
      >
        <div className="grid-corner" />
        {rooms.map((r) => (
          <div key={r.id} className="grid-room" title={r.name}>{r.name}</div>
        ))}

        <div className="grid-times" aria-hidden="true">
          {slots.map((m) => (
            <div key={m} className={`grid-time ${m % 60 !== 0 ? 'is-half' : ''}`}>
              {minutesToLabel(m)}
            </div>
          ))}
          {showNow && (
            <span className="now-label" style={{ top: nowTop }}>{minutesToLabel(Math.floor(nowMinutes))}</span>
          )}
        </div>

        {rooms.map((room) => {
          const roomBookings = bookings.filter((b) => b.room_id === room.id)
          const ranges = roomBookings.map((b) => ({
            s: utcToZoned(new Date(b.starts_at), settings.timezone).minutes,
            e: utcToZoned(new Date(b.ends_at), settings.timezone).minutes,
          }))

          // Ao clicar num bloco, sugere o primeiro minuto livre dentro dele
          // (depois da hora atual e de reservas que ocupam só parte do bloco).
          const suggest = (m: number) => {
            let start = m
            if (isToday && start <= nowMinutes) start = Math.floor(nowMinutes) + 1
            for (let moved = true; moved; ) {
              moved = false
              for (const r of ranges) {
                if (r.s <= start && start < r.e) {
                  start = Math.ceil(r.e)
                  moved = true
                }
              }
            }
            if (start >= m + step || start >= close) return null
            const nextBooking = Math.min(close, ...ranges.filter((r) => r.s > start).map((r) => r.s))
            return { start, end: Math.min(start + step, nextBooking) }
          }

          return (
            <div key={room.id} className="grid-col" style={{ height: span(slots.length * step) }}>
              {slots.map((m) => {
                const past = isPastDay || (isToday && m + step <= nowMinutes)
                const label = `${room.name}, ${minutesToLabel(m)}`
                return (
                  <button
                    key={m}
                    className={`slot ${m % 60 === 0 ? 'is-hour' : ''}`}
                    disabled={past}
                    onClick={() => {
                      const free = suggest(m)
                      if (free) onSlotClick(room.id, free.start, free.end)
                    }}
                    aria-label={past ? `${label} (indisponível)` : `Reservar ${label}`}
                  />
                )
              })}

              {roomBookings.map((b) => {
                const s = utcToZoned(new Date(b.starts_at), settings.timezone).minutes
                const e = utcToZoned(new Date(b.ends_at), settings.timezone).minutes
                const from = Math.max(s, open)
                const to = Math.min(e, close)
                const mine = b.user_id === meId
                const compact = e - s <= step
                const tiny = e - s < step / 2
                const ended = isPastDay || (isToday && e <= nowMinutes)
                const who = mine ? 'Você' : b.profiles?.full_name ?? '—'
                return (
                  <button
                    key={b.id}
                    className={`booking ${mine ? 'is-mine' : ''} ${compact ? 'is-compact' : ''} ${tiny ? 'is-tiny' : ''} ${ended ? 'is-past' : ''}`}
                    style={tiny ? { top: at(from, 0.5), height: span(to - from, -1) } : { top: at(from, 2), height: span(to - from, -4) }}
                    onClick={() => onBookingClick(b)}
                    title={`${b.subject} — ${minutesToLabel(s)}–${minutesToLabel(e)} — ${b.profiles?.full_name ?? ''}`}
                  >
                    <span className="b-subject">{b.subject}</span>
                    <span className="b-meta">
                      {minutesToLabel(s)}–{minutesToLabel(e)} · {who}
                    </span>
                  </button>
                )
              })}

              {showNow && <div className="now-line" style={{ top: nowTop }} />}
            </div>
          )
        })}

      </div>
    </div>
  )
}
