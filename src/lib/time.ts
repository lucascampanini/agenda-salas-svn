// Conversões entre o fuso do escritório (America/Campo_Grande) e UTC,
// independentes do fuso configurado no computador de quem acessa.

const partsCache = new Map<string, Intl.DateTimeFormat>()

function formatter(tz: string) {
  let f = partsCache.get(tz)
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    })
    partsCache.set(tz, f)
  }
  return f
}

interface ZonedParts {
  year: number
  month: number
  day: number
  hour: number
  minute: number
  second: number
}

function zonedParts(date: Date, tz: string): ZonedParts {
  const out: Record<string, number> = {}
  for (const p of formatter(tz).formatToParts(date)) {
    if (p.type !== 'literal') out[p.type] = Number(p.value)
  }
  return {
    year: out.year,
    month: out.month,
    day: out.day,
    hour: out.hour % 24,
    minute: out.minute,
    second: out.second,
  }
}

function offsetMs(date: Date, tz: string) {
  const p = zonedParts(date, tz)
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second)
  return asUtc - Math.floor(date.getTime() / 1000) * 1000
}

/** "2026-09-29" + minutos desde 00:00 no fuso do escritório -> instante UTC */
export function zonedToUtc(ymd: string, minutes: number, tz: string): Date {
  const [y, m, d] = ymd.split('-').map(Number)
  const guess = Date.UTC(y, m - 1, d, 0, minutes)
  let t = guess - offsetMs(new Date(guess), tz)
  const second = guess - offsetMs(new Date(t), tz)
  if (second !== t) t = second
  return new Date(t)
}

/** instante -> { ymd, minutes } no fuso do escritório */
export function utcToZoned(date: Date, tz: string) {
  const p = zonedParts(date, tz)
  return {
    ymd: `${p.year}-${pad(p.month)}-${pad(p.day)}`,
    minutes: p.hour * 60 + p.minute + p.second / 60,
  }
}

export function pad(n: number) {
  return String(n).padStart(2, '0')
}

export function todayYmd(tz: string) {
  return utcToZoned(new Date(), tz).ymd
}

/** "08:00:00" -> 480 */
export function timeToMinutes(t: string) {
  const [h, m] = t.split(':').map(Number)
  return h * 60 + m
}

/** "09:07" -> 547; texto incompleto ou inválido -> null */
export function parseTime(text: string): number | null {
  const m = /^(\d{1,2}):(\d{2})/.exec(text.trim())
  if (!m) return null
  const h = Number(m[1])
  const min = Number(m[2])
  if (h > 23 || min > 59) return null
  return h * 60 + min
}

export function formatDuration(min: number) {
  const h = Math.floor(min / 60)
  const m = min % 60
  if (h === 0) return `${m} min`
  return m === 0 ? `${h}h` : `${h}h${String(m).padStart(2, '0')}`
}

/** 480 -> "08:00" */
export function minutesToLabel(min: number) {
  return `${pad(Math.floor(min / 60))}:${pad(Math.round(min % 60))}`
}

// ----- aritmética de datas "puras" (YYYY-MM-DD), sem fuso -----

function ymdToUtcNoon(ymd: string) {
  const [y, m, d] = ymd.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d, 12))
}

function dateToYmd(d: Date) {
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`
}

export function addDays(ymd: string, n: number) {
  const d = ymdToUtcNoon(ymd)
  d.setUTCDate(d.getUTCDate() + n)
  return dateToYmd(d)
}

/** 1 = segunda ... 7 = domingo */
export function isoWeekday(ymd: string) {
  const w = ymdToUtcNoon(ymd).getUTCDay()
  return w === 0 ? 7 : w
}

export function mondayOf(ymd: string) {
  return addDays(ymd, 1 - isoWeekday(ymd))
}

/** Sábado/domingo vão para a segunda seguinte */
export function nearestWeekday(ymd: string) {
  const w = isoWeekday(ymd)
  return w >= 6 ? addDays(ymd, 8 - w) : ymd
}

export function weekDays(ymd: string) {
  const mon = mondayOf(ymd)
  return [0, 1, 2, 3, 4].map((i) => addDays(mon, i))
}

const WEEKDAY_SHORT = ['', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb', 'Dom']
const WEEKDAY_LONG = ['', 'segunda-feira', 'terça-feira', 'quarta-feira', 'quinta-feira', 'sexta-feira', 'sábado', 'domingo']
const MONTHS = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez']
const MONTHS_LONG = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro']

export function weekdayShort(ymd: string) {
  return WEEKDAY_SHORT[isoWeekday(ymd)]
}

export function dayOfMonth(ymd: string) {
  return Number(ymd.slice(8, 10))
}

/** "terça-feira, 29 de setembro" */
export function longDate(ymd: string) {
  const [, m, d] = ymd.split('-').map(Number)
  return `${WEEKDAY_LONG[isoWeekday(ymd)]}, ${d} de ${MONTHS_LONG[m - 1]}`
}

/** "29 set" */
export function shortDate(ymd: string) {
  const [, m, d] = ymd.split('-').map(Number)
  return `${d} ${MONTHS[m - 1]}`
}

/** "29 set – 3 out 2026" */
export function weekRangeLabel(ymd: string) {
  const days = weekDays(ymd)
  return `${shortDate(days[0])} – ${shortDate(days[4])} ${days[4].slice(0, 4)}`
}
