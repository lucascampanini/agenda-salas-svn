// Convites de calendário sem servidor de e-mail: o convite sai do Outlook da
// própria pessoa (link que abre o evento já preenchido) ou de um arquivo .ics.

export const OFFICE_NAME = 'SVN Investimentos · Campo Grande'

export interface InviteEvent {
  id: string
  title: string
  starts_at: string // ISO UTC
  ends_at: string
  location: string
  description: string
  attendees: string[]
}

/** Abre o Outlook (Microsoft 365) com a reunião preenchida; a pessoa só clica em Enviar. */
export function outlookComposeUrl(ev: InviteEvent) {
  const params = new URLSearchParams({
    path: '/calendar/action/compose',
    rru: 'addevent',
    subject: ev.title,
    startdt: new Date(ev.starts_at).toISOString(),
    enddt: new Date(ev.ends_at).toISOString(),
    location: ev.location,
    body: ev.description,
  })
  if (ev.attendees.length) params.set('to', ev.attendees.join(','))
  return `https://outlook.office.com/calendar/0/deeplink/compose?${params.toString().replace(/\+/g, '%20')}`
}

/** Baixa um .ics (abre no Outlook do computador, Google Agenda, iPhone...). */
export function downloadIcs(ev: InviteEvent) {
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//SVN Investimentos//Agenda de Salas//PT',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:${ev.id}@agenda-salas-svn`,
    `DTSTAMP:${icsDate(new Date().toISOString())}`,
    `DTSTART:${icsDate(ev.starts_at)}`,
    `DTEND:${icsDate(ev.ends_at)}`,
    `SUMMARY:${icsText(ev.title)}`,
    `LOCATION:${icsText(ev.location)}`,
    `DESCRIPTION:${icsText(ev.description)}`,
    ...ev.attendees.map((a) => `ATTENDEE;ROLE=REQ-PARTICIPANT;RSVP=TRUE:mailto:${a}`),
    'END:VEVENT',
    'END:VCALENDAR',
  ]
  const blob = new Blob([lines.map(fold).join('\r\n') + '\r\n'], { type: 'text/calendar;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `${ev.title.replace(/[^\p{L}\p{N} _-]+/gu, '').trim().slice(0, 60) || 'reuniao'}.ics`
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

/** Separa "a@x.com; b@y.com, c@z.com" em lista; devolve também os inválidos. */
export function parseEmails(text: string) {
  const all = text
    .split(/[\s,;]+/)
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean)
  const unique = [...new Set(all)]
  return {
    valid: unique.filter((e) => EMAIL_RE.test(e)),
    invalid: unique.filter((e) => !EMAIL_RE.test(e)),
  }
}

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/

function icsDate(iso: string) {
  return new Date(iso).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '')
}

function icsText(s: string) {
  return s.replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/([,;])/g, '\\$1')
}

// linhas do .ics têm no máximo 75 caracteres
function fold(line: string) {
  const out: string[] = []
  let rest = line
  while (rest.length > 74) {
    out.push(rest.slice(0, 74))
    rest = ' ' + rest.slice(74)
  }
  out.push(rest)
  return out.join('\r\n')
}

/** Convite de uma reserva de sala */
export function roomInvite(
  b: { id: string; subject: string; starts_at: string; ends_at: string },
  roomName: string,
  attendees: string[],
): InviteEvent {
  const location = `${OFFICE_NAME} — ${roomName}`
  return {
    id: b.id,
    title: b.subject,
    starts_at: b.starts_at,
    ends_at: b.ends_at,
    location,
    description: `Local: ${location}.\n\nSala reservada pela Agenda SVN.`,
    attendees: [...new Set(attendees)],
  }
}
