import { supabase } from './supabase'

/** Chama a função serverless /api/admin-users com o token da sessão atual. */
export async function adminApi(body: Record<string, unknown>): Promise<string | null> {
  const { data } = await supabase.auth.getSession()
  const token = data.session?.access_token
  if (!token) return 'Sua sessão expirou. Entre novamente.'
  try {
    const res = await fetch('/api/admin-users', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      body: JSON.stringify(body),
    })
    const json = (await res.json().catch(() => ({}))) as { error?: string }
    if (!res.ok) return json.error ?? `Erro no servidor (${res.status}).`
    return null
  } catch {
    return 'Sem conexão com o servidor. Verifique sua internet e tente de novo.'
  }
}
