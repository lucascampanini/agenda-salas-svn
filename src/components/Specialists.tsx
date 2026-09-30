import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { supabase } from '../lib/supabase'
import { friendlyError } from '../lib/errors'
import type { Profile, Room, Settings, SpecialistBooking, SpecialistVisit } from '../lib/types'
import {
  addDays,
  formatDuration,
  isoWeekday,
  longDate,
  minutesToLabel,
  parseTime,
  shortDate,
  timeToMinutes,
  todayYmd,
  utcToZoned,
  weekdayShort,
  zonedToUtc,
} from '../lib/time'
import { OFFICE_NAME, parseEmails, type InviteEvent } from '../lib/invite'
import { ConfirmDialog, Modal } from './ui'
import { InviteModal } from './InviteModal'

const SB_COLUMNS =
  'id, visit_id, user_id, starts_at, ends_at, subject, location, room_booking_id, external_place, guest_emails, profiles(full_name, email)'
const DEFAULT_MINUTES = 60
const MIN_GAP = 10 // intervalos livres menores que isso não aparecem
// atendimento nos dias da visita (padrão do banco: specialist_visits.day_start/day_end)
const DAY_START = '07:00:00'
const DAY_END = '19:00:00'

interface Props {
  me: Profile
  rooms: Room[]
  settings: Settings
  notify: (text: string, kind?: 'ok' | 'error') => void
}

type Pick3 = { day: string; start: number; end: number }

export function SpecialistsView({ me, rooms, settings, notify }: Props) {
  const tz = settings.timezone
  const [visits, setVisits] = useState<SpecialistVisit[]>([])
  const [items, setItems] = useState<SpecialistBooking[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [now, setNow] = useState(() => new Date())

  const [booking, setBooking] = useState<{ visit: SpecialistVisit; initial: Pick3 } | null>(null)
  const [editing, setEditing] = useState<SpecialistVisit | 'new' | null>(null)
  const [toDelete, setToDelete] = useState<SpecialistVisit | null>(null)
  const [toCancel, setToCancel] = useState<SpecialistBooking | null>(null)
  const [invite, setInvite] = useState<InviteEvent | null>(null)
  const [busy, setBusy] = useState(false)
  const [dialogError, setDialogError] = useState<string | null>(null)

  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 30_000)
    return () => clearInterval(t)
  }, [])

  const load = useCallback(async () => {
    const vs = await supabase
      .from('specialist_visits')
      .select('id, specialist_name, specialty, specialist_email, starts_at, ends_at, day_start, day_end, include_weekends, notes')
      .gt('ends_at', new Date().toISOString())
      .order('starts_at')
    if (vs.error) {
      setLoadError(friendlyError(vs.error))
      setLoading(false)
      return
    }
    const list = (vs.data ?? []) as SpecialistVisit[]
    const bk = list.length
      ? await supabase.from('specialist_bookings').select(SB_COLUMNS).in('visit_id', list.map((v) => v.id)).order('starts_at')
      : { data: [], error: null }
    setLoadError(bk.error ? friendlyError(bk.error) : null)
    setVisits(list)
    if (bk.data) setItems(bk.data as unknown as SpecialistBooking[])
    setLoading(false)
  }, [])

  useEffect(() => {
    load()
  }, [load])

  // tempo real: agendamentos dos colegas aparecem na hora
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined
    const refresh = () => {
      clearTimeout(timer)
      timer = setTimeout(load, 250)
    }
    const channel = supabase
      .channel('especialistas')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'specialist_visits' }, refresh)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'specialist_bookings' }, refresh)
      .subscribe()
    return () => {
      clearTimeout(timer)
      supabase.removeChannel(channel)
    }
  }, [load])

  const selected = visits.find((v) => v.id === selectedId) ?? visits[0] ?? null
  const mine = items.filter((b) => b.user_id === me.id && new Date(b.ends_at) > now)
  const roomName = (id: string | null) => rooms.find((r) => r.id === id)?.name ?? 'Sala'
  const visitOf = (b: SpecialistBooking) => visits.find((v) => v.id === b.visit_id)

  // a sala não vem no agendamento; busca pela reserva ligada
  async function inviteFor(b: SpecialistBooking) {
    const v = visitOf(b)
    if (!v) return
    let room: string | null = null
    if (b.room_booking_id) {
      const { data } = await supabase.from('bookings').select('room_id').eq('id', b.room_booking_id).maybeSingle()
      room = data ? roomName(data.room_id as string) : null
    }
    setInvite(buildInvite(v, b, room))
  }

  async function confirmCancel() {
    if (!toCancel) return
    setBusy(true)
    setDialogError(null)
    const { error } = await supabase.rpc('cancel_specialist_booking', { p_id: toCancel.id })
    setBusy(false)
    if (error) return setDialogError(friendlyError(error))
    setToCancel(null)
    notify(toCancel.room_booking_id ? 'Horário cancelado e sala liberada.' : 'Horário cancelado.')
    load()
  }

  async function confirmDelete() {
    if (!toDelete) return
    setBusy(true)
    setDialogError(null)
    const { data, error } = await supabase.from('specialist_visits').delete().eq('id', toDelete.id).select('id')
    setBusy(false)
    if (error) return setDialogError(friendlyError(error))
    if (!data?.length) return setDialogError('Você não tem permissão para excluir agendas de especialistas.')
    setToDelete(null)
    notify('Agenda do especialista excluída.')
    load()
  }

  function when(iso: string, endIso: string) {
    const s = utcToZoned(new Date(iso), tz)
    const e = utcToZoned(new Date(endIso), tz)
    return `${dayLabel(s.ymd, tz)} · ${minutesToLabel(s.minutes)}–${minutesToLabel(e.minutes)}`
  }

  const deleteCount = toDelete ? items.filter((b) => b.visit_id === toDelete.id && new Date(b.ends_at) > now).length : 0

  return (
    <>
      <div className="toolbar">
        <h1 className="toolbar-title">Agenda de especialistas</h1>
        <div className="toolbar-spacer" />
        {me.is_admin && (
          <button className="btn btn-primary" onClick={() => setEditing('new')}>+ Nova agenda</button>
        )}
      </div>

      {loadError && <div className="alert" role="alert" style={{ marginBottom: 12 }}>{loadError}</div>}

      <div className="layout">
        <section aria-label="Visitas de especialistas">
          {loading && visits.length === 0 ? (
            <div className="card empty-card">Carregando…</div>
          ) : visits.length === 0 ? (
            <div className="card empty-card">
              Nenhum especialista com visita marcada.
              {me.is_admin && ' Clique em “Nova agenda” para abrir a agenda de um especialista.'}
            </div>
          ) : (
            <>
              <nav className="visit-tabs" aria-label="Especialistas">
                {visits.map((v) => {
                  const count = items.filter((b) => b.visit_id === v.id).length
                  return (
                    <button
                      key={v.id}
                      className={`visit-tab ${selected?.id === v.id ? 'is-selected' : ''}`}
                      onClick={() => setSelectedId(v.id)}
                      aria-current={selected?.id === v.id ? 'true' : undefined}
                    >
                      <span className="vt-date">{periodLabel(v, tz)}</span>
                      <span className="vt-name">{v.specialist_name}</span>
                      <span className="vt-meta">{count === 0 ? 'Nenhum agendamento' : count === 1 ? '1 agendamento' : `${count} agendamentos`}</span>
                    </button>
                  )
                })}
              </nav>
              {selected && (
                <VisitPanel
                  visit={selected}
                  items={items.filter((b) => b.visit_id === selected.id)}
                  me={me}
                  now={now}
                  tz={tz}
                  step={settings.slot_minutes}
                  onBook={(initial) => setBooking({ visit: selected, initial })}
                  onEdit={() => setEditing(selected)}
                  onDelete={() => { setDialogError(null); setToDelete(selected) }}
                  onCancel={(b) => { setDialogError(null); setToCancel(b) }}
                  onInvite={inviteFor}
                />
              )}
            </>
          )}
        </section>

        <aside className="card side" aria-labelledby="my-specialists-title">
          <div className="side-head">
            <h3 id="my-specialists-title">Seus horários com especialistas</h3>
          </div>
          {mine.length === 0 ? (
            <div className="side-empty">Você não tem horários agendados. Escolha um especialista e clique em um horário livre.</div>
          ) : (
            <ul className="upcoming">
              {mine.map((b) => {
                const v = visitOf(b)
                return (
                  <li key={b.id}>
                    <button
                      className="up-when"
                      style={{ border: 0, padding: 0, background: 'none', cursor: 'pointer', textAlign: 'left' }}
                      onClick={() => setSelectedId(b.visit_id)}
                      title="Ver na agenda do especialista"
                    >
                      {when(b.starts_at, b.ends_at)}
                    </button>
                    <div className="up-subject">{b.subject}</div>
                    <div className="up-room">
                      {v?.specialist_name} · {b.location === 'office' ? 'No escritório' : b.external_place || 'Fora do escritório'}
                    </div>
                    <div className="up-actions">
                      <button className="btn btn-sm" onClick={() => inviteFor(b)}>Convite</button>
                      <button className="btn btn-sm btn-danger" onClick={() => { setDialogError(null); setToCancel(b) }}>Cancelar</button>
                    </div>
                  </li>
                )
              })}
            </ul>
          )}
        </aside>
      </div>

      {booking && (
        <SpecialistBookingForm
          visit={booking.visit}
          initial={booking.initial}
          items={items.filter((b) => b.visit_id === booking.visit.id)}
          rooms={rooms}
          settings={settings}
          onClose={() => {
            setBooking(null)
            load()
          }}
          onSaved={(message, ev) => {
            setBooking(null)
            notify(message)
            setInvite(ev)
            load()
          }}
        />
      )}

      {editing && (
        <VisitForm
          visit={editing === 'new' ? null : editing}
          settings={settings}
          onClose={() => setEditing(null)}
          onSaved={(message, id) => {
            setEditing(null)
            notify(message)
            setSelectedId(id)
            load()
          }}
        />
      )}

      {invite && <InviteModal ev={invite} onClose={() => setInvite(null)} />}

      {toCancel && (
        <ConfirmDialog
          title="Cancelar horário?"
          message={
            <>
              <strong>{toCancel.subject}</strong>
              <br />
              <span className="muted">
                {visitOf(toCancel)?.specialist_name} · {when(toCancel.starts_at, toCancel.ends_at)}
              </span>
              {toCancel.room_booking_id && <p className="small muted" style={{ marginBottom: 0 }}>A reserva da sala também será cancelada.</p>}
              {toCancel.user_id !== me.id && (
                <p className="small muted" style={{ marginBottom: 0 }}>
                  Este horário é de {toCancel.profiles?.full_name ?? 'outra pessoa'}. Como administrador, você pode cancelá-lo.
                </p>
              )}
            </>
          }
          confirmLabel="Sim, cancelar"
          busy={busy}
          error={dialogError}
          onConfirm={confirmCancel}
          onCancel={() => setToCancel(null)}
        />
      )}

      {toDelete && (
        <ConfirmDialog
          title={`Excluir a agenda de ${toDelete.specialist_name}?`}
          message={
            deleteCount > 0 ? (
              <>
                Esta visita tem <strong>{deleteCount === 1 ? '1 horário agendado' : `${deleteCount} horários agendados`}</strong>, que{' '}
                {deleteCount === 1 ? 'será cancelado' : 'serão cancelados'} junto com as reservas de sala. Avise os colegas. Essa ação não pode ser desfeita.
              </>
            ) : (
              'Ninguém agendou horário ainda. Essa ação não pode ser desfeita.'
            )
          }
          confirmLabel="Excluir agenda"
          busy={busy}
          error={dialogError}
          onConfirm={confirmDelete}
          onCancel={() => setToDelete(null)}
        />
      )}
    </>
  )
}

/* -------------------------- Uma visita -------------------------- */

function VisitPanel({
  visit,
  items,
  me,
  now,
  tz,
  step,
  onBook,
  onEdit,
  onDelete,
  onCancel,
  onInvite,
}: {
  visit: SpecialistVisit
  items: SpecialistBooking[]
  me: Profile
  now: Date
  tz: string
  step: number
  onBook: (initial: Pick3) => void
  onEdit: () => void
  onDelete: () => void
  onCancel: (b: SpecialistBooking) => void
  onInvite: (b: SpecialistBooking) => void
}) {
  const [details, setDetails] = useState<SpecialistBooking | null>(null)
  const today = todayYmd(tz)
  const nowMin = utcToZoned(now, tz).minutes
  const days = visitDays(visit, tz).filter((d) => d >= today)
  const windows = days.map((d) => dailyWindow(visit, tz, d))

  // linhas da grade cobrem todos os dias, alinhadas ao relógio (chegada às 09:10 cai na linha das 09:00)
  const first = Math.floor(Math.min(...windows.map((w) => w.open)) / step) * step
  const last = Math.max(...windows.map((w) => w.close))
  const slots: number[] = []
  for (let m = first; m < last; m += step) slots.push(m)
  const at = (minutes: number, extraPx = 0) => `calc(var(--slot-h) * ${(minutes - first) / step} + ${extraPx}px)`
  const span = (minutes: number, extraPx = 0) => `calc(var(--slot-h) * ${minutes / step} + ${extraPx}px)`
  const showNow = days[0] === today && nowMin >= first && nowMin <= last

  return (
    <div>
      <div className="card visit-head">
        <div className="grow">
          <h2>{visit.specialist_name}</h2>
          {visit.specialty && <div className="muted">{visit.specialty}</div>}
          <div className="visit-when">
            {visitSummary(visit, tz)}
            {visit.include_weekends ? ' (inclusive fim de semana)' : ''}
          </div>
          {visit.notes && <p className="small visit-notes">{visit.notes}</p>}
        </div>
        {me.is_admin && (
          <div className="inline-actions">
            <button className="btn btn-sm" onClick={onEdit}>Editar</button>
            <button className="btn btn-sm btn-danger" onClick={onDelete}>Excluir</button>
          </div>
        )}
      </div>

      <div className="day-heading">
        <h2>Clique num horário livre para agendar</h2>
        <div className="legend" aria-hidden="true">
          <span><i className="lg-mine" />Meus</span>
          <span><i className="lg-other" />Colegas</span>
          <span><i className="lg-past" />Indisponível</span>
        </div>
      </div>

      <div className="grid-scroll" role="region" aria-label={`Agenda de ${visit.specialist_name}`} tabIndex={0}>
        <div className="grid" style={{ gridTemplateColumns: `var(--time-w) repeat(${days.length}, minmax(148px, 1fr))` }}>
          <div className="grid-corner" />
          {days.map((d) => (
            <div key={d} className="grid-room" title={longDate(d)}>
              {weekdayShort(d)}, {shortDate(d)}{d === today ? ' · hoje' : ''}
            </div>
          ))}

          <div className="grid-times" aria-hidden="true">
            {slots.map((m) => (
              <div key={m} className={`grid-time ${m % 60 !== 0 ? 'is-half' : ''}`}>{minutesToLabel(m)}</div>
            ))}
            {showNow && <span className="now-label" style={{ top: at(nowMin) }}>{minutesToLabel(Math.floor(nowMin))}</span>}
          </div>

          {days.map((d, i) => {
            const isToday = d === today
            const dayItems = items.filter((b) => utcToZoned(new Date(b.starts_at), tz).ymd === d)
            const gaps = freeGaps(dayItems, windows[i].open, windows[i].close, tz, isToday ? nowMin : null)
            return (
              <div key={d} className="grid-col" style={{ height: span(slots.length * step) }}>
                {slots.map((m) => {
                  // primeiro intervalo livre que toca este bloco
                  const gap = gaps.find((g) => g.s < m + step && g.e > m)
                  const label = `${weekdayShort(d)} ${shortDate(d)}, ${minutesToLabel(m)}`
                  return (
                    <button
                      key={m}
                      className={`slot ${m % 60 === 0 ? 'is-hour' : ''}`}
                      disabled={!gap}
                      onClick={() => {
                        if (!gap) return
                        const start = Math.max(gap.s, m)
                        onBook({ day: d, start, end: Math.min(start + DEFAULT_MINUTES, gap.e) })
                      }}
                      aria-label={gap ? `Agendar ${label}` : `${label} (indisponível)`}
                    />
                  )
                })}

                {dayItems.map((b) => {
                  const s = utcToZoned(new Date(b.starts_at), tz).minutes
                  const e = utcToZoned(new Date(b.ends_at), tz).minutes
                  const isMine = b.user_id === me.id
                  const compact = e - s <= step
                  const tiny = e - s < step / 2
                  const ended = new Date(b.ends_at) <= now
                  const who = isMine ? 'Você' : b.profiles?.full_name ?? '—'
                  const where = b.location === 'office' ? 'escritório' : 'fora'
                  return (
                    <button
                      key={b.id}
                      className={`booking ${isMine ? 'is-mine' : ''} ${compact ? 'is-compact' : ''} ${tiny ? 'is-tiny' : ''} ${ended ? 'is-past' : ''}`}
                      style={tiny ? { top: at(s, 0.5), height: span(e - s, -1) } : { top: at(s, 2), height: span(e - s, -4) }}
                      onClick={() => setDetails(b)}
                      title={`${b.subject} — ${minutesToLabel(s)}–${minutesToLabel(e)} — ${b.profiles?.full_name ?? ''} (${where})`}
                    >
                      <span className="b-subject">{b.subject}</span>
                      <span className="b-meta">{minutesToLabel(s)}–{minutesToLabel(e)} · {who} · {where}</span>
                    </button>
                  )
                })}

                {isToday && showNow && <div className="now-line" style={{ top: at(nowMin) }} />}
              </div>
            )
          })}
        </div>
      </div>

      {details && (
        <SpecialistBookingDetails
          booking={details}
          visit={visit}
          me={me}
          tz={tz}
          now={now}
          onClose={() => setDetails(null)}
          onInvite={() => { setDetails(null); onInvite(details) }}
          onCancel={() => { setDetails(null); onCancel(details) }}
        />
      )}
    </div>
  )
}

function SpecialistBookingDetails({
  booking: b,
  visit,
  me,
  tz,
  now,
  onClose,
  onInvite,
  onCancel,
}: {
  booking: SpecialistBooking
  visit: SpecialistVisit
  me: Profile
  tz: string
  now: Date
  onClose: () => void
  onInvite: () => void
  onCancel: () => void
}) {
  const s = utcToZoned(new Date(b.starts_at), tz)
  const e = utcToZoned(new Date(b.ends_at), tz)
  const isMine = b.user_id === me.id
  const active = new Date(b.ends_at) > now
  return (
    <Modal
      title={b.subject}
      onClose={onClose}
      footer={
        <>
          {active && (isMine || me.is_admin) && <button className="btn btn-danger" onClick={onCancel}>Cancelar horário</button>}
          {active && isMine && <button className="btn" onClick={onInvite}>Convite</button>}
          <button className="btn btn-primary" onClick={onClose}>Fechar</button>
        </>
      }
    >
      <dl className="detail-list">
        <dt>Especialista</dt>
        <dd>{visit.specialist_name}</dd>
        <dt>Data</dt>
        <dd>{longDate(s.ymd)}</dd>
        <dt>Horário</dt>
        <dd>{minutesToLabel(s.minutes)} às {minutesToLabel(e.minutes)}</dd>
        <dt>Agendado por</dt>
        <dd>{isMine ? `Você (${b.profiles?.full_name ?? ''})` : b.profiles?.full_name ?? '—'}</dd>
        <dt>Local</dt>
        <dd>{b.location === 'office' ? 'No escritório (sala reservada)' : b.external_place || 'Fora do escritório'}</dd>
        {b.guest_emails.length > 0 && (
          <>
            <dt>Convidados</dt>
            <dd>{b.guest_emails.join(', ')}</dd>
          </>
        )}
      </dl>
    </Modal>
  )
}

/* ------------------------ Agendar horário ------------------------ */

function SpecialistBookingForm({
  visit,
  initial,
  items,
  rooms,
  settings,
  onClose,
  onSaved,
}: {
  visit: SpecialistVisit
  initial: Pick3
  items: SpecialistBooking[]
  rooms: Room[]
  settings: Settings
  onClose: () => void
  onSaved: (message: string, ev: InviteEvent) => void
}) {
  const tz = settings.timezone
  const today = todayYmd(tz)
  const days = visitDays(visit, tz).filter((d) => d >= today)

  const [day, setDay] = useState(initial.day)
  const { open, close } = dailyWindow(visit, tz, day)
  const [startText, setStartText] = useState(minutesToLabel(initial.start))
  const [endText, setEndText] = useState(minutesToLabel(initial.end))
  const start = parseTime(startText)
  const end = parseTime(endText)
  const timesOk = start !== null && end !== null && end > start

  const [subject, setSubject] = useState('')
  const [location, setLocation] = useState<'office' | 'external'>('office')
  const [roomId, setRoomId] = useState<string>('')
  const [place, setPlace] = useState('')
  const [emails, setEmails] = useState('')
  const [busyRooms, setBusyRooms] = useState<Set<string> | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const dayItems = items.filter((b) => utcToZoned(new Date(b.starts_at), tz).ymd === day)
  const gaps = freeGaps(dayItems, open, close, tz, day === today ? utcToZoned(new Date(), tz).minutes : null)

  // reunião no escritório precisa caber nas regras da agenda de salas
  const officeOpen = timeToMinutes(settings.open_time)
  const officeClose = timeToMinutes(settings.close_time)
  const officeProblem =
    isoWeekday(day) > 5
      ? 'As salas só podem ser reservadas de segunda a sexta.'
      : timesOk && (start < officeOpen || end > officeClose)
        ? `As salas só podem ser reservadas das ${minutesToLabel(officeOpen)} às ${minutesToLabel(officeClose)}.`
        : null
  const where = officeProblem ? 'external' : location

  const startIso = timesOk ? zonedToUtc(day, start, tz).toISOString() : null
  const endIso = timesOk ? zonedToUtc(day, end, tz).toISOString() : null

  // salas ocupadas no horário escolhido (espera a pessoa parar de digitar)
  useEffect(() => {
    if (!startIso || !endIso) return setBusyRooms(null)
    setBusyRooms(null)
    const t = setTimeout(() => {
      supabase
        .from('bookings')
        .select('room_id')
        .lt('starts_at', endIso)
        .gt('ends_at', startIso)
        .then(({ data }) => {
          const taken = new Set((data ?? []).map((r) => r.room_id as string))
          setBusyRooms(taken)
          setRoomId((cur) => (cur && !taken.has(cur) ? cur : rooms.find((r) => !taken.has(r.id))?.id || ''))
        })
    }, 300)
    return () => clearTimeout(t)
  }, [startIso, endIso, rooms])

  const freeRooms = rooms.filter((r) => !busyRooms?.has(r.id))

  function changeStart(text: string) {
    const next = parseTime(text)
    // mantém a duração ao mudar o início
    if (next !== null && timesOk) setEndText(minutesToLabel(Math.min(next + (end - start), close)))
    setStartText(text)
  }

  function pickGap(g: { s: number; e: number }) {
    setStartText(minutesToLabel(g.s))
    setEndText(minutesToLabel(Math.min(g.s + DEFAULT_MINUTES, g.e)))
  }

  function validate(): string | null {
    if (!day) return 'Escolha o dia.'
    if (start === null) return 'Informe o horário de início (ex.: 09:10).'
    if (end === null) return 'Informe o horário de fim (ex.: 10:00).'
    if (end <= start) return 'O fim precisa ser depois do início.'
    if (start < open || end > close) {
      return `Nesse dia o especialista atende das ${minutesToLabel(open)} às ${minutesToLabel(close)}.`
    }
    if (day === today && start <= utcToZoned(new Date(), tz).minutes) return 'Não é possível agendar um horário que já passou.'
    const clash = dayItems.find((b) => {
      const s = utcToZoned(new Date(b.starts_at), tz).minutes
      const e = utcToZoned(new Date(b.ends_at), tz).minutes
      return s < end && start < e
    })
    if (clash) {
      const s = utcToZoned(new Date(clash.starts_at), tz).minutes
      const e = utcToZoned(new Date(clash.ends_at), tz).minutes
      return `O especialista já está com ${clash.profiles?.full_name ?? 'outra pessoa'} das ${minutesToLabel(s)} às ${minutesToLabel(e)}. Escolha outro horário.`
    }
    if (!subject.trim()) return 'Informe o assunto (ex.: nome do cliente).'
    if (where === 'office' && !roomId) return 'Escolha a sala.'
    return null
  }

  async function submit(ev: FormEvent) {
    ev.preventDefault()
    const v = validate()
    if (v) return setError(v)
    const parsed = parseEmails(emails)
    if (parsed.invalid.length) return setError(`E-mail inválido: ${parsed.invalid[0]}`)
    if (!startIso || !endIso || start === null) return
    setBusy(true)
    setError(null)
    const { data, error } = await supabase.rpc('book_specialist', {
      p_visit_id: visit.id,
      p_starts_at: startIso,
      p_ends_at: endIso,
      p_subject: subject.trim(),
      p_location: where,
      p_room_id: where === 'office' ? roomId : null,
      p_external_place: where === 'external' ? place.trim() : '',
      p_guest_emails: parsed.valid,
    })
    setBusy(false)
    if (error) return setError(friendlyError(error))
    const room = where === 'office' ? rooms.find((r) => r.id === roomId)?.name ?? 'Sala' : null
    const booking = {
      id: data as string,
      starts_at: startIso,
      ends_at: endIso,
      subject: subject.trim(),
      location: where,
      external_place: place.trim(),
      guest_emails: parsed.valid,
    }
    const at = `${dayLabel(day, tz).toLowerCase()} às ${minutesToLabel(start)}`
    onSaved(
      room ? `Agendado com ${visit.specialist_name} ${at}. ${room} reservada.` : `Agendado com ${visit.specialist_name} ${at}.`,
      buildInvite(visit, booking, room),
    )
  }

  return (
    <Modal
      title={`Agendar com ${visit.specialist_name}`}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn" onClick={onClose} disabled={busy}>Cancelar</button>
          <button type="submit" form="specialist-form" className="btn btn-primary" disabled={busy}>
            {busy ? 'Agendando…' : 'Agendar'}
          </button>
        </>
      }
    >
      <form id="specialist-form" className="stack" onSubmit={submit} noValidate>
        <label className="field">
          <span>Dia</span>
          <select className="select" value={day} onChange={(e) => setDay(e.target.value)}>
            {days.map((d) => (
              <option key={d} value={d}>{longDate(d).replace(/^./, (c) => c.toUpperCase())}</option>
            ))}
          </select>
        </label>

        <div className="gaps">
          {gaps.length === 0 ? (
            <span className="muted small">Sem horários livres neste dia.</span>
          ) : (
            <>
              <span className="muted small">Livre:</span>
              {gaps.map((g) => (
                <button type="button" key={g.s} className="gap-chip" onClick={() => pickGap(g)}>
                  {minutesToLabel(g.s)}–{minutesToLabel(g.e)}
                </button>
              ))}
            </>
          )}
        </div>

        <div className="row-2">
          <label className="field">
            <span>Início</span>
            <input
              className="input"
              type="time"
              step={60}
              min={minutesToLabel(open)}
              max={minutesToLabel(close)}
              value={startText}
              onChange={(e) => changeStart(e.target.value)}
              required
            />
          </label>
          <label className="field">
            <span>Fim</span>
            <input
              className="input"
              type="time"
              step={60}
              min={minutesToLabel(open)}
              max={minutesToLabel(close)}
              value={endText}
              onChange={(e) => setEndText(e.target.value)}
              required
            />
          </label>
        </div>
        <p className="small muted" style={{ margin: '-6px 0 0' }}>
          Escolha o horário que for melhor para você. Nesse dia o especialista atende das {minutesToLabel(open)} às {minutesToLabel(close)}.
          {timesOk && ` Duração: ${formatDuration(end - start)}.`}
        </p>

        <label className="field">
          <span>Assunto</span>
          <input
            className="input"
            value={subject}
            maxLength={120}
            placeholder="Ex.: Planejamento sucessório — cliente João Silva"
            autoFocus
            onChange={(ev) => setSubject(ev.target.value)}
            required
          />
        </label>

        <fieldset className="field choice">
          <legend>Onde vai ser a reunião?</legend>
          <div className="seg">
            <label className={where === 'office' ? 'is-on' : ''}>
              <input
                type="radio"
                name="location"
                checked={where === 'office'}
                disabled={!!officeProblem}
                onChange={() => setLocation('office')}
              />
              No escritório
            </label>
            <label className={where === 'external' ? 'is-on' : ''}>
              <input type="radio" name="location" checked={where === 'external'} onChange={() => setLocation('external')} />
              Fora do escritório
            </label>
          </div>
          {officeProblem && <span className="small muted">{officeProblem} Por isso, nesse horário só dá para marcar fora.</span>}
        </fieldset>

        {where === 'office' ? (
          <label className="field">
            <span>Sala (fica reservada automaticamente na agenda de salas)</span>
            {!timesOk ? (
              <select className="select" disabled><option>Informe o horário primeiro</option></select>
            ) : busyRooms === null ? (
              <select className="select" disabled><option>Verificando salas livres…</option></select>
            ) : freeRooms.length === 0 ? (
              <div className="alert">Todas as salas estão ocupadas nesse horário. Escolha “Fora do escritório” ou outro horário.</div>
            ) : (
              <select className="select" value={roomId} onChange={(ev) => setRoomId(ev.target.value)}>
                {rooms.map((r) => (
                  <option key={r.id} value={r.id} disabled={busyRooms.has(r.id)}>
                    {r.name}{busyRooms.has(r.id) ? ' (ocupada)' : ''}
                  </option>
                ))}
              </select>
            )}
          </label>
        ) : (
          <label className="field">
            <span>Local (opcional)</span>
            <input
              className="input"
              value={place}
              maxLength={160}
              placeholder="Ex.: Escritório do cliente, Av. Afonso Pena, 1000"
              onChange={(ev) => setPlace(ev.target.value)}
            />
          </label>
        )}

        <label className="field">
          <span>Outros e-mails para o convite (opcional)</span>
          <input
            className="input"
            value={emails}
            placeholder="cliente@email.com, colega@svn.com.br"
            autoComplete="off"
            onChange={(ev) => setEmails(ev.target.value)}
          />
          <span className="small muted">
            Separe por vírgula.{visit.specialist_email ? ` O e-mail do especialista (${visit.specialist_email}) já entra no convite.` : ''}
          </span>
        </label>

        {error && <div className="alert" role="alert">{error}</div>}
      </form>
    </Modal>
  )
}

/* ---------------------- Criar / editar visita ---------------------- */

function VisitForm({
  visit,
  settings,
  onClose,
  onSaved,
}: {
  visit: SpecialistVisit | null
  settings: Settings
  onClose: () => void
  onSaved: (message: string, id: string) => void
}) {
  const tz = settings.timezone
  const s0 = visit ? utcToZoned(new Date(visit.starts_at), tz) : null
  const e0 = visit ? utcToZoned(new Date(visit.ends_at), tz) : null
  const tomorrow = addDays(todayYmd(tz), 1)

  const [name, setName] = useState(visit?.specialist_name ?? '')
  const [specialty, setSpecialty] = useState(visit?.specialty ?? '')
  const [email, setEmail] = useState(visit?.specialist_email ?? '')
  const [firstDay, setFirstDay] = useState(s0?.ymd ?? tomorrow)
  const [lastDay, setLastDay] = useState(e0?.ymd ?? tomorrow)
  const [start, setStart] = useState(s0 ? minutesToLabel(s0.minutes) : '09:00')
  const [end, setEnd] = useState(e0 ? minutesToLabel(e0.minutes) : '16:00')
  const [weekends, setWeekends] = useState(visit?.include_weekends ?? false)
  const [notes, setNotes] = useState(visit?.notes ?? '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const startMin = parseTime(start)
  const endMin = parseTime(end)
  // prévia com as mesmas regras da grade
  const draft: SpecialistVisit | null =
    firstDay && lastDay && startMin !== null && endMin !== null
      ? {
          id: '',
          specialist_name: '',
          specialty: '',
          specialist_email: null,
          starts_at: zonedToUtc(firstDay, startMin, tz).toISOString(),
          ends_at: zonedToUtc(lastDay, endMin, tz).toISOString(),
          day_start: visit?.day_start ?? DAY_START,
          day_end: visit?.day_end ?? DAY_END,
          include_weekends: weekends,
          notes: '',
        }
      : null
  const valid = !!draft && draft.ends_at > draft.starts_at
  const dayCount = valid && daysBetween(firstDay, lastDay).length <= 60 ? visitDays(draft, tz).length : 0

  function changeFirstDay(d: string) {
    setFirstDay(d)
    if (d && (!lastDay || lastDay < d)) setLastDay(d)
  }

  async function submit(ev: FormEvent) {
    ev.preventDefault()
    if (!name.trim()) return setError('Informe o nome do especialista.')
    if (!firstDay || !lastDay) return setError('Informe o dia da chegada e o dia da saída.')
    if (startMin === null || endMin === null) return setError('Informe o horário da chegada e o da saída.')
    if (!valid || !draft) return setError('A saída precisa ser depois da chegada.')
    if (daysBetween(firstDay, lastDay).length > 60) return setError('O período pode ter no máximo 60 dias.')
    if (dayCount === 0) return setError('Não sobra nenhum horário de atendimento. Confira as datas, os horários ou marque “Atende também no fim de semana”.')
    const mail = email.trim().toLowerCase()
    if (mail && parseEmails(mail).invalid.length) return setError('E-mail do especialista inválido.')
    setBusy(true)
    setError(null)
    const row = {
      specialist_name: name.trim(),
      specialty: specialty.trim(),
      specialist_email: mail || null,
      starts_at: draft.starts_at,
      ends_at: draft.ends_at,
      include_weekends: weekends,
      notes: notes.trim(),
    }
    const res = visit
      ? await supabase.from('specialist_visits').update(row).eq('id', visit.id).select('id')
      : await supabase.from('specialist_visits').insert(row).select('id')
    setBusy(false)
    if (res.error) return setError(friendlyError(res.error))
    if (!res.data?.length) return setError('Você não tem permissão para fazer isso.')
    onSaved(visit ? 'Agenda atualizada.' : `Agenda de ${row.specialist_name} criada.`, res.data[0].id as string)
  }

  return (
    <Modal
      title={visit ? 'Editar agenda do especialista' : 'Nova agenda de especialista'}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn" onClick={onClose} disabled={busy}>Cancelar</button>
          <button type="submit" form="visit-form" className="btn btn-primary" disabled={busy}>
            {busy ? 'Salvando…' : visit ? 'Salvar' : 'Criar agenda'}
          </button>
        </>
      }
    >
      <form id="visit-form" className="stack" onSubmit={submit} noValidate>
        <label className="field">
          <span>Nome do especialista</span>
          <input className="input" value={name} maxLength={80} onChange={(e) => setName(e.target.value)} placeholder="Ex.: Maria Souza" required />
        </label>
        <label className="field">
          <span>Especialidade / empresa (opcional)</span>
          <input className="input" value={specialty} maxLength={120} onChange={(e) => setSpecialty(e.target.value)} placeholder="Ex.: Previdência — XP" />
        </label>
        <label className="field">
          <span>E-mail do especialista (opcional, entra nos convites)</span>
          <input className="input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="off" />
        </label>
        <div className="row-2">
          <label className="field">
            <span>Chega no dia</span>
            <input className="input" type="date" value={firstDay} min={visit ? undefined : todayYmd(tz)} onChange={(e) => changeFirstDay(e.target.value)} required />
          </label>
          <label className="field">
            <span>A partir das</span>
            <input className="input" type="time" step={60} value={start} onChange={(e) => setStart(e.target.value)} required />
          </label>
        </div>
        <div className="row-2">
          <label className="field">
            <span>Vai embora no dia</span>
            <input className="input" type="date" value={lastDay} min={firstDay || undefined} onChange={(e) => setLastDay(e.target.value)} required />
          </label>
          <label className="field">
            <span>Até as</span>
            <input className="input" type="time" step={60} value={end} onChange={(e) => setEnd(e.target.value)} required />
          </label>
        </div>
        <label className="check">
          <input type="checkbox" checked={weekends} onChange={(e) => setWeekends(e.target.checked)} />
          Atende também no fim de semana
        </label>
        {dayCount > 0 && draft && (
          <p className="small muted" style={{ margin: 0 }}>
            {dayCount === 1 ? '1 dia' : `${dayCount} dias`} de atendimento. {visitSummary(draft, tz)}. Os assessores escolhem o horário e a duração
            que quiserem.
          </p>
        )}
        <label className="field">
          <span>Observações (opcional)</span>
          <textarea className="input textarea" value={notes} maxLength={500} rows={2} onChange={(e) => setNotes(e.target.value)} placeholder="Ex.: Trazer extrato do cliente" />
        </label>
        {visit && (
          <p className="small muted" style={{ margin: 0 }}>
            Se já houver horários agendados, a nova chegada e a nova saída precisam continuar incluindo todos eles.
          </p>
        )}
        {error && <div className="alert" role="alert">{error}</div>}
      </form>
    </Modal>
  )
}

/* ----------------------------- Apoio ----------------------------- */

/** Atendimento do dia, em minutos desde 00:00: começa na chegada no 1º dia e termina na saída no último */
function dailyWindow(v: SpecialistVisit, tz: string, day: string) {
  const arrive = utcToZoned(new Date(v.starts_at), tz)
  const leave = utcToZoned(new Date(v.ends_at), tz)
  let open = timeToMinutes(v.day_start)
  let close = timeToMinutes(v.day_end)
  if (day === arrive.ymd) open = Math.max(open, arrive.minutes)
  if (day === leave.ymd) close = Math.min(close, leave.minutes)
  return { open, close }
}

/** "Chega seg, 20 out às 09:00 e vai embora sex, 24 out às 16:00 · nos demais dias, das 07:00 às 19:00" */
function visitSummary(v: SpecialistVisit, tz: string) {
  const a = utcToZoned(new Date(v.starts_at), tz)
  const l = utcToZoned(new Date(v.ends_at), tz)
  const hours = `das ${v.day_start.slice(0, 5)} às ${v.day_end.slice(0, 5)}`
  if (a.ymd === l.ymd) {
    const w = dailyWindow(v, tz, a.ymd)
    return `${longDate(a.ymd).replace(/^./, (c) => c.toUpperCase())}, das ${minutesToLabel(w.open)} às ${minutesToLabel(w.close)}`
  }
  const middle = daysBetween(a.ymd, l.ymd).length > 2 ? ` · nos demais dias, ${hours}` : ''
  return `Chega ${weekdayShort(a.ymd).toLowerCase()}, ${shortDate(a.ymd)} às ${minutesToLabel(a.minutes)} e vai embora ${weekdayShort(l.ymd).toLowerCase()}, ${shortDate(l.ymd)} às ${minutesToLabel(l.minutes)}${middle}`
}

function daysBetween(first: string, last: string) {
  const out: string[] = []
  for (let d = first; d <= last && out.length <= 62; d = addDays(d, 1)) out.push(d)
  return out
}

/** Dias de atendimento da visita (sem fim de semana, se for o caso; sem dias vazios) */
function visitDays(v: SpecialistVisit, tz: string) {
  const first = utcToZoned(new Date(v.starts_at), tz).ymd
  const last = utcToZoned(new Date(v.ends_at), tz).ymd
  return daysBetween(first, last).filter((d) => {
    if (!v.include_weekends && isoWeekday(d) > 5) return false
    const w = dailyWindow(v, tz, d)
    return w.close > w.open
  })
}

/** Intervalos livres do dia entre os agendamentos (e depois da hora atual, se for hoje) */
function freeGaps(dayItems: SpecialistBooking[], open: number, close: number, tz: string, nowMin: number | null) {
  const busy = dayItems
    .map((b) => ({ s: utcToZoned(new Date(b.starts_at), tz).minutes, e: utcToZoned(new Date(b.ends_at), tz).minutes }))
    .sort((a, b) => a.s - b.s)
  const gaps: { s: number; e: number }[] = []
  let cursor = nowMin === null ? open : Math.max(open, Math.floor(nowMin) + 1)
  for (const b of busy) {
    if (b.s > cursor) gaps.push({ s: cursor, e: b.s })
    cursor = Math.max(cursor, b.e)
  }
  if (close > cursor) gaps.push({ s: cursor, e: close })
  return gaps.filter((g) => g.e - g.s >= MIN_GAP)
}

/** "Seg, 20 out" ou "20 out – 24 out" */
function periodLabel(v: SpecialistVisit, tz: string) {
  const first = utcToZoned(new Date(v.starts_at), tz).ymd
  const last = utcToZoned(new Date(v.ends_at), tz).ymd
  return first === last ? `${weekdayShort(first)}, ${shortDate(first)}` : `${shortDate(first)} – ${shortDate(last)}`
}

function dayLabel(ymd: string, tz: string) {
  const today = todayYmd(tz)
  if (ymd === today) return 'Hoje'
  if (ymd === addDays(today, 1)) return 'Amanhã'
  return `${weekdayShort(ymd)}, ${shortDate(ymd)}`
}

function buildInvite(
  v: SpecialistVisit,
  b: Pick<SpecialistBooking, 'id' | 'starts_at' | 'ends_at' | 'subject' | 'location' | 'external_place' | 'guest_emails'>,
  room: string | null,
): InviteEvent {
  const location =
    b.location === 'office' ? `${OFFICE_NAME}${room ? ` — ${room}` : ''}` : b.external_place || 'Fora do escritório'
  const who = v.specialty ? `${v.specialist_name} (${v.specialty})` : v.specialist_name
  return {
    id: b.id,
    title: `${b.subject} — ${v.specialist_name}`,
    starts_at: b.starts_at,
    ends_at: b.ends_at,
    location,
    description: `Reunião com ${who}.\nLocal: ${location}.\n\nAgendado pela Agenda SVN.`,
    attendees: [...new Set([v.specialist_email, ...b.guest_emails].filter((e): e is string => !!e))],
  }
}
