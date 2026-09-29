import { useMemo, useState, type FormEvent } from 'react'
import { supabase } from '../lib/supabase'
import { friendlyError } from '../lib/errors'
import type { Booking, Room, Settings } from '../lib/types'
import { isoWeekday, minutesToLabel, timeToMinutes, todayYmd, utcToZoned, zonedToUtc } from '../lib/time'
import { Modal } from './ui'

interface Props {
  rooms: Room[]
  settings: Settings
  meId: string
  initial: { roomId: string; day: string; start: number; end: number }
  /** Reservas já carregadas do dia exibido, para avisar conflito antes de enviar */
  knownBookings: { day: string; items: Booking[] }
  onClose: () => void
  onSaved: (message: string) => void
}

export function BookingForm({ rooms, settings, meId, initial, knownBookings, onClose, onSaved }: Props) {
  const open = timeToMinutes(settings.open_time)
  const close = timeToMinutes(settings.close_time)
  const step = settings.slot_minutes
  const tz = settings.timezone

  const [roomId, setRoomId] = useState(initial.roomId)
  const [day, setDay] = useState(initial.day)
  // Guardamos o texto "HH:MM" do campo para permitir digitação livre (ex.: 09:07)
  const [startText, setStartText] = useState(minutesToLabel(initial.start))
  const [endText, setEndText] = useState(minutesToLabel(initial.end))
  const start = parseTime(startText)
  const end = parseTime(endText)
  const [subject, setSubject] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Sugestões de 30 em 30 minutos; qualquer outro horário pode ser digitado
  const startOptions = useMemo(() => {
    const out: number[] = []
    for (let m = open; m < close; m += step) out.push(m)
    return out
  }, [open, close, step])

  const endOptions = useMemo(() => {
    const out: number[] = []
    for (let m = open + step; m <= close; m += step) if (start === null || m > start) out.push(m)
    return out
  }, [open, start, close, step])

  function changeStart(text: string) {
    const next = parseTime(text)
    // mantém a duração da reunião ao mudar o início
    if (next !== null && start !== null && end !== null && end > start) {
      setEndText(minutesToLabel(Math.min(next + (end - start), close)))
    }
    setStartText(text)
  }

  function validate(): string | null {
    const today = todayYmd(tz)
    if (!day) return 'Escolha a data.'
    if (isoWeekday(day) > 5) return 'As reservas só podem ser feitas de segunda a sexta.'
    if (day < today) return 'Não é possível reservar um horário que já passou.'
    if (start === null) return 'Informe o horário de início (ex.: 09:10).'
    if (end === null) return 'Informe o horário de fim (ex.: 09:45).'
    if (start < open || end > close) {
      return `Horário fora do funcionamento (das ${minutesToLabel(open)} às ${minutesToLabel(close)}).`
    }
    const nowMin = utcToZoned(new Date(), tz).minutes
    if (day === today && start <= nowMin) return 'Não é possível reservar um horário que já passou.'
    if (end <= start) return 'O fim precisa ser depois do início.'
    if (!subject.trim()) return 'Informe o assunto da reunião.'

    if (knownBookings.day === day) {
      const clash = knownBookings.items.find((b) => {
        if (b.room_id !== roomId) return false
        const s = utcToZoned(new Date(b.starts_at), tz).minutes
        const e = utcToZoned(new Date(b.ends_at), tz).minutes
        return s < end && start < e
      })
      if (clash) {
        const s = utcToZoned(new Date(clash.starts_at), tz).minutes
        const e = utcToZoned(new Date(clash.ends_at), tz).minutes
        return `Essa sala já está reservada das ${minutesToLabel(s)} às ${minutesToLabel(e)} (${clash.profiles?.full_name ?? 'outra pessoa'}). Escolha outro horário.`
      }
    }
    return null
  }

  async function submit(e: FormEvent) {
    e.preventDefault()
    const v = validate()
    if (v) return setError(v)
    if (start === null || end === null) return
    setBusy(true)
    setError(null)
    const { error } = await supabase.from('bookings').insert({
      room_id: roomId,
      user_id: meId,
      starts_at: zonedToUtc(day, start, tz).toISOString(),
      ends_at: zonedToUtc(day, end, tz).toISOString(),
      subject: subject.trim(),
    })
    setBusy(false)
    if (error) return setError(friendlyError(error))
    const room = rooms.find((r) => r.id === roomId)?.name ?? 'Sala'
    onSaved(`Reserva confirmada: ${room}, ${minutesToLabel(start)}–${minutesToLabel(end)}.`)
  }

  return (
    <Modal
      title="Nova reserva"
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn" onClick={onClose} disabled={busy}>Cancelar</button>
          <button type="submit" form="booking-form" className="btn btn-primary" disabled={busy}>
            {busy ? 'Reservando…' : 'Reservar'}
          </button>
        </>
      }
    >
      <form id="booking-form" className="stack" onSubmit={submit} noValidate>
        <label className="field">
          <span>Sala</span>
          <select className="select" value={roomId} onChange={(e) => setRoomId(e.target.value)}>
            {rooms.map((r) => (
              <option key={r.id} value={r.id}>{r.name}</option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Data</span>
          <input
            className="input"
            type="date"
            value={day}
            min={todayYmd(tz)}
            onChange={(e) => setDay(e.target.value)}
            required
          />
        </label>
        <div className="row-2">
          <label className="field">
            <span>Início</span>
            <input
              className="input"
              type="time"
              step={60}
              min={minutesToLabel(open)}
              max={minutesToLabel(close)}
              list="start-options"
              value={startText}
              onChange={(e) => changeStart(e.target.value)}
              required
            />
            <datalist id="start-options">
              {startOptions.map((m) => (
                <option key={m} value={minutesToLabel(m)} />
              ))}
            </datalist>
          </label>
          <label className="field">
            <span>Fim</span>
            <input
              className="input"
              type="time"
              step={60}
              min={minutesToLabel(open)}
              max={minutesToLabel(close)}
              list="end-options"
              value={endText}
              onChange={(e) => setEndText(e.target.value)}
              required
            />
            <datalist id="end-options">
              {endOptions.map((m) => (
                <option key={m} value={minutesToLabel(m)} />
              ))}
            </datalist>
          </label>
        </div>
        <p className="small muted" style={{ margin: '-6px 0 0' }}>
          Digite qualquer horário (ex.: 09:10 às 09:45) ou escolha uma das sugestões.
          {start !== null && end !== null && end > start && ` Duração: ${formatDuration(end - start)}.`}
        </p>
        <label className="field">
          <span>Assunto</span>
          <input
            className="input"
            value={subject}
            maxLength={120}
            placeholder="Ex.: Reunião com cliente"
            autoFocus
            onChange={(e) => setSubject(e.target.value)}
            required
          />
        </label>
        {error && <div className="alert" role="alert">{error}</div>}
      </form>
    </Modal>
  )
}

/** "09:07" -> 547; texto incompleto ou inválido -> null */
function parseTime(text: string): number | null {
  const m = /^(\d{1,2}):(\d{2})/.exec(text.trim())
  if (!m) return null
  const h = Number(m[1])
  const min = Number(m[2])
  if (h > 23 || min > 59) return null
  return h * 60 + min
}

function formatDuration(min: number) {
  const h = Math.floor(min / 60)
  const m = min % 60
  if (h === 0) return `${m} min`
  return m === 0 ? `${h}h` : `${h}h${String(m).padStart(2, '0')}`
}
