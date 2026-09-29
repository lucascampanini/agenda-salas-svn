import { supabase } from './supabase'
import { friendlyError } from './errors'

/**
 * Cancela uma reserva. O RLS do Postgres não gera erro quando a linha não pode
 * ser apagada — ela simplesmente não é afetada. Por isso conferimos quantas
 * linhas saíram de fato.
 */
export async function cancelBooking(id: string): Promise<string | null> {
  const { data, error } = await supabase.from('bookings').delete().eq('id', id).select('id')
  if (error) return friendlyError(error)
  if (!data || data.length === 0) {
    return 'Não foi possível cancelar: você só pode cancelar as suas próprias reservas (ou ela já foi cancelada).'
  }
  return null
}
