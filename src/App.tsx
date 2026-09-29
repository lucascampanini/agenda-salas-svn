import { useCallback, useEffect, useRef, useState } from 'react'
import type { Session } from '@supabase/supabase-js'
import { configMissing, supabase } from './lib/supabase'
import { friendlyError } from './lib/errors'
import { DEFAULT_SETTINGS, type Booking, type Profile, type Room, type Settings } from './lib/types'
import {
  addDays,
  dayOfMonth,
  longDate,
  nearestWeekday,
  todayYmd,
  utcToZoned,
  weekDays,
  weekRangeLabel,
  weekdayShort,
  zonedToUtc,
} from './lib/time'
import { Login } from './components/Login'
import { DayGrid } from './components/DayGrid'
import { BookingForm } from './components/BookingForm'
import { BookingDetails } from './components/BookingDetails'
import { UpcomingPanel } from './components/UpcomingPanel'
import { AdminPanel } from './components/AdminPanel'
import { IconLeft, IconLogout, IconMoon, IconRight, IconSettings, IconSun, Toast } from './components/ui'

const BOOKING_COLUMNS = 'id, room_id, user_id, starts_at, ends_at, subject, profiles(full_name)'

/* ------------------------------ Tema ------------------------------ */

function useTheme() {
  const [theme, setTheme] = useState<'light' | 'dark'>(() => {
    try {
      const saved = localStorage.getItem('theme')
      if (saved === 'light' || saved === 'dark') return saved
    } catch { /* sem storage */ }
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
  })
  useEffect(() => {
    document.documentElement.dataset.theme = theme
    try { localStorage.setItem('theme', theme) } catch { /* sem storage */ }
  }, [theme])
  return [theme, () => setTheme((t) => (t === 'dark' ? 'light' : 'dark'))] as const
}

/* ------------------------------ App ------------------------------ */

export default function App() {
  const [session, setSession] = useState<Session | null | undefined>(undefined)
  const [profile, setProfile] = useState<Profile | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session))
    const { data } = supabase.auth.onAuthStateChange((_e, s) => setSession(s))
    return () => data.subscription.unsubscribe()
  }, [])

  const userId = session?.user.id
  useEffect(() => {
    if (!userId) return setProfile(null)
    supabase
      .from('profiles')
      .select('*')
      .eq('id', userId)
      .maybeSingle()
      .then(({ data }) => {
        if (!data || !data.active) {
          setNotice('Seu acesso está desativado ou ainda não foi liberado. Fale com um administrador.')
          supabase.auth.signOut()
          return
        }
        setNotice(null)
        setProfile(data as Profile)
      })
  }, [userId])

  if (configMissing) {
    return (
      <div className="center-msg">
        Configuração ausente: defina VITE_SUPABASE_URL e VITE_SUPABASE_ANON_KEY nas variáveis de ambiente.
      </div>
    )
  }
  if (session === undefined) return <div className="center-msg">Carregando…</div>
  if (!session) return <Login notice={notice} />
  if (!profile) return <div className="center-msg">Carregando…</div>
  return <Agenda me={profile} onProfileChange={setProfile} />
}

/* ----------------------------- Agenda ----------------------------- */

function Agenda({ me, onProfileChange }: { me: Profile; onProfileChange: (p: Profile) => void }) {
  const [theme, toggleTheme] = useTheme()
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS)
  const tz = settings.timezone

  const [day, setDay] = useState(() => nearestWeekday(todayYmd(DEFAULT_SETTINGS.timezone)))
  const [now, setNow] = useState(() => new Date())
  const [view, setView] = useState<'agenda' | 'admin'>('agenda')

  const [rooms, setRooms] = useState<Room[]>([])
  const [bookings, setBookings] = useState<Booking[]>([])
  const [upcoming, setUpcoming] = useState<Booking[]>([])
  const [profiles, setProfiles] = useState<Profile[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)

  const [creating, setCreating] = useState<{ roomId: string; day: string; start: number } | null>(null)
  const [selected, setSelected] = useState<Booking | null>(null)
  const [toast, setToast] = useState<{ text: string; kind: 'ok' | 'error'; id: number } | null>(null)

  const notify = useCallback((text: string, kind: 'ok' | 'error' = 'ok') => setToast({ text, kind, id: Date.now() }), [])
  const clearToast = useCallback(() => setToast(null), [])

  // relógio: atualiza a linha da hora atual e os horários que já passaram
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 30_000)
    return () => clearInterval(t)
  }, [])

  const dayRef = useRef(day)
  dayRef.current = day

  const load = useCallback(async () => {
    const d = dayRef.current
    const [st, rm, bk, up, pf] = await Promise.all([
      supabase.from('settings').select('timezone, open_time, close_time, slot_minutes').maybeSingle(),
      supabase.from('rooms').select('id, name, position').order('position').order('name'),
      supabase
        .from('bookings')
        .select(BOOKING_COLUMNS)
        .gte('starts_at', zonedToUtc(d, 0, tz).toISOString())
        .lt('starts_at', zonedToUtc(addDays(d, 1), 0, tz).toISOString())
        .order('starts_at'),
      supabase
        .from('bookings')
        .select(BOOKING_COLUMNS)
        .eq('user_id', me.id)
        .gt('ends_at', new Date().toISOString())
        .order('starts_at')
        .limit(30),
      supabase.from('profiles').select('*'),
    ])
    const firstError = [st, rm, bk, up, pf].find((r) => r.error)?.error
    setLoadError(firstError ? friendlyError(firstError) : null)
    if (st.data) setSettings(st.data as Settings)
    if (rm.data) setRooms(rm.data as Room[])
    if (bk.data && dayRef.current === d) setBookings(bk.data as unknown as Booking[])
    if (up.data) setUpcoming(up.data as unknown as Booking[])
    if (pf.data) {
      const list = pf.data as Profile[]
      setProfiles(list)
      const mine = list.find((p) => p.id === me.id)
      if (mine && (mine.is_admin !== me.is_admin || mine.full_name !== me.full_name)) onProfileChange(mine)
      if (mine && !mine.active) supabase.auth.signOut()
    }
    setLoading(false)
  }, [me, tz, onProfileChange])

  useEffect(() => {
    load()
  }, [load, day])

  // Tempo real: qualquer mudança em reservas, salas ou perfis recarrega os dados.
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined
    const refresh = () => {
      clearTimeout(timer)
      timer = setTimeout(load, 250)
    }
    const channel = supabase
      .channel('agenda')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'bookings' }, refresh)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'rooms' }, refresh)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'profiles' }, refresh)
      .subscribe()
    const onFocus = () => document.visibilityState === 'visible' && refresh()
    document.addEventListener('visibilitychange', onFocus)
    return () => {
      clearTimeout(timer)
      document.removeEventListener('visibilitychange', onFocus)
      supabase.removeChannel(channel)
    }
  }, [load])

  // se o admin foi rebaixado enquanto estava no painel
  useEffect(() => {
    if (!me.is_admin && view === 'admin') setView('agenda')
  }, [me.is_admin, view])

  const today = todayYmd(tz)
  const nowMinutes = utcToZoned(now, tz).minutes
  const days = weekDays(day)

  function goToday() {
    setDay(nearestWeekday(today))
    setView('agenda')
  }

  function afterChange(message: string) {
    setCreating(null)
    setSelected(null)
    notify(message)
    load()
  }

  return (
    <>
      <header className="topbar">
        <div className="brand">
          <div className="brand-mark">SVN</div>
          <div>
            <div className="brand-name">Agenda de Salas</div>
            <div className="brand-sub">SVN Investimentos · Campo Grande/MS</div>
          </div>
        </div>
        <div className="topbar-actions">
          <span className="user-chip" title={me.email}>{me.full_name}</span>
          {me.is_admin && (
            <button
              className={`btn btn-sm ${view === 'admin' ? 'btn-primary' : ''}`}
              onClick={() => setView(view === 'admin' ? 'agenda' : 'admin')}
            >
              <IconSettings /> <span>Admin</span>
            </button>
          )}
          <button
            className="btn btn-ghost btn-icon"
            onClick={toggleTheme}
            aria-label={theme === 'dark' ? 'Usar modo claro' : 'Usar modo escuro'}
            title={theme === 'dark' ? 'Modo claro' : 'Modo escuro'}
          >
            {theme === 'dark' ? <IconSun /> : <IconMoon />}
          </button>
          <button className="btn btn-ghost btn-icon" onClick={() => supabase.auth.signOut()} aria-label="Sair" title="Sair">
            <IconLogout />
          </button>
        </div>
      </header>

      <main className="page">
        {loadError && <div className="alert" role="alert" style={{ marginBottom: 12 }}>{loadError}</div>}

        {view === 'admin' && me.is_admin ? (
          <AdminPanel rooms={rooms} profiles={profiles} meId={me.id} onBack={() => setView('agenda')} notify={notify} reload={load} />
        ) : (
          <>
            <div className="toolbar">
              <h1 className="toolbar-title">{weekRangeLabel(day)}</h1>
              <div className="toolbar-spacer" />
              <button className="btn btn-icon" onClick={() => setDay(addDays(days[0], -7))} aria-label="Semana anterior" title="Semana anterior">
                <IconLeft />
              </button>
              <button className="btn" onClick={goToday}>Hoje</button>
              <button className="btn btn-icon" onClick={() => setDay(addDays(days[0], 7))} aria-label="Próxima semana" title="Próxima semana">
                <IconRight />
              </button>
              <input
                className="input"
                type="date"
                aria-label="Escolher data"
                value={day}
                onChange={(e) => e.target.value && setDay(nearestWeekday(e.target.value))}
              />
            </div>

            <nav className="daytabs" aria-label="Dias da semana">
              {days.map((d) => (
                <button
                  key={d}
                  className={`daytab ${d === day ? 'is-selected' : ''} ${d === today ? 'is-today' : ''}`}
                  onClick={() => setDay(d)}
                  aria-current={d === day ? 'date' : undefined}
                  aria-label={`${longDate(d)}${d === today ? ' (hoje)' : ''}`}
                >
                  <span className="dt-wd">{weekdayShort(d)}</span>
                  <span className="dt-d">{dayOfMonth(d)}</span>
                </button>
              ))}
            </nav>

            <div className="layout">
              <section aria-label="Agenda do dia">
                <div className="day-heading">
                  <h2>
                    {longDate(day).replace(/^./, (c) => c.toUpperCase())}
                    {day === today && <span className="muted"> · hoje</span>}
                  </h2>
                  <div className="legend" aria-hidden="true">
                    <span><i className="lg-mine" />Minhas</span>
                    <span><i className="lg-other" />Colegas</span>
                    <span><i className="lg-past" />Indisponível</span>
                  </div>
                </div>
                <DayGrid
                  day={day}
                  todayYmd={today}
                  nowMinutes={nowMinutes}
                  rooms={rooms}
                  bookings={bookings}
                  settings={settings}
                  meId={me.id}
                  onSlotClick={(roomId, start) => setCreating({ roomId, day, start })}
                  onBookingClick={setSelected}
                />
              </section>

              <UpcomingPanel
                items={upcoming}
                rooms={rooms}
                settings={settings}
                loading={loading}
                onOpenDay={(d) => setDay(d)}
                onCancelled={afterChange}
              />
            </div>
          </>
        )}
      </main>

      {creating && (
        <BookingForm
          rooms={rooms}
          settings={settings}
          meId={me.id}
          initial={creating}
          knownBookings={{ day, items: bookings }}
          onClose={() => {
            setCreating(null)
            load()
          }}
          onSaved={afterChange}
        />
      )}

      {selected && (
        <BookingDetails
          booking={selected}
          rooms={rooms}
          settings={settings}
          meId={me.id}
          isAdmin={me.is_admin}
          onClose={() => setSelected(null)}
          onCancelled={afterChange}
        />
      )}

      {toast && <Toast key={toast.id} text={toast.text} kind={toast.kind} onDone={clearToast} />}
    </>
  )
}
