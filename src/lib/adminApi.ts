import { FunctionsHttpError } from '@supabase/supabase-js'
import { supabase } from './supabase'

/** Chama a Edge Function "admin-users" do Supabase com a sessão atual. */
export async function adminApi(body: Record<string, unknown>): Promise<string | null> {
  const { error } = await supabase.functions.invoke('admin-users', { body })
  if (!error) return null
  if (error instanceof FunctionsHttpError) {
    const json = (await error.context.json().catch(() => ({}))) as { error?: string }
    return json.error ?? `Erro no servidor (${error.context.status}).`
  }
  return 'Não foi possível falar com o servidor. Verifique sua internet e tente de novo.'
}
