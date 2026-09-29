export interface Settings {
  timezone: string
  open_time: string // "08:00:00"
  close_time: string // "18:00:00"
  slot_minutes: number // linhas da grade
  booking_step_minutes: number // precisão das reservas (1 = qualquer minuto)
}

export interface Profile {
  id: string
  full_name: string
  email: string
  is_admin: boolean
  active: boolean
  pending: boolean // cadastrou-se pelo link de convite e aguarda aprovação
  created_at: string
}

export interface Room {
  id: string
  name: string
  position: number
}

export interface Booking {
  id: string
  room_id: string
  user_id: string
  starts_at: string
  ends_at: string
  subject: string
  profiles: { full_name: string } | null
  rooms?: { name: string } | null
}

export const DEFAULT_SETTINGS: Settings = {
  timezone: 'America/Campo_Grande',
  open_time: '08:00:00',
  close_time: '18:00:00',
  slot_minutes: 30,
  booking_step_minutes: 1,
}
