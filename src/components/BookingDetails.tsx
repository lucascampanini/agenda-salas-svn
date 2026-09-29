import { useState } from 'react'
import type { Booking, Room, Settings } from '../lib/types'
import { longDate, minutesToLabel, utcToZoned } from '../lib/time'
import { cancelBooking } from '../lib/bookings'
import { Modal } from './ui'

interface Props {
  booking: Booking
  rooms: Room[]
  settings: Settings
  meId: string
  isAdmin: boolean
  onClose: () => void
  onCancelled: (message: string) => void
}

export function BookingDetails({ booking, rooms, settings, meId, isAdmin, onClose, onCancelled }: Props) {
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const tz = settings.timezone
  const s = utcToZoned(new Date(booking.starts_at), tz)
  const e = utcToZoned(new Date(booking.ends_at), tz)
  const mine = booking.user_id === meId
  const canCancel = (mine || isAdmin) && new Date(booking.ends_at) > new Date()
  const room = rooms.find((r) => r.id === booking.room_id)?.name ?? '—'

  async function doCancel() {
    setBusy(true)
    setError(null)
    const err = await cancelBooking(booking.id)
    setBusy(false)
    if (err) return setError(err)
    onCancelled('Reserva cancelada.')
  }

  return (
    <Modal
      title={booking.subject}
      onClose={onClose}
      footer={
        confirming ? (
          <>
            <button className="btn" onClick={() => setConfirming(false)} disabled={busy}>Voltar</button>
            <button className="btn btn-danger-solid" onClick={doCancel} disabled={busy}>
              {busy ? 'Cancelando…' : 'Sim, cancelar reserva'}
            </button>
          </>
        ) : (
          <>
            {canCancel && (
              <button className="btn btn-danger" onClick={() => setConfirming(true)}>Cancelar reserva</button>
            )}
            <button className="btn btn-primary" onClick={onClose}>Fechar</button>
          </>
        )
      }
    >
      <dl className="detail-list">
        <dt>Sala</dt>
        <dd>{room}</dd>
        <dt>Data</dt>
        <dd>{longDate(s.ymd)}</dd>
        <dt>Horário</dt>
        <dd>{minutesToLabel(s.minutes)} às {minutesToLabel(e.minutes)}</dd>
        <dt>Reservado por</dt>
        <dd>{mine ? `Você (${booking.profiles?.full_name ?? ''})` : booking.profiles?.full_name ?? '—'}</dd>
      </dl>
      {confirming && (
        <p style={{ margin: 0 }}>
          {mine
            ? 'Tem certeza de que quer cancelar esta reserva?'
            : `Esta reserva é de ${booking.profiles?.full_name ?? 'outra pessoa'}. Como administrador, você pode cancelá-la. Confirma?`}
        </p>
      )}
      {error && <div className="alert" role="alert">{error}</div>}
    </Modal>
  )
}
