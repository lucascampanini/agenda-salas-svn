// Função serverless (Vercel) para gestão de usuários.
// Roda só no servidor: é o único lugar que conhece a SUPABASE_SERVICE_ROLE_KEY.
// Toda chamada confere, pelo token de quem chama, se a pessoa é administradora ativa.

import { createClient, type SupabaseClient } from '@supabase/supabase-js'

const SUPABASE_URL = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY

const BAN_FOREVER = '876000h' // ~100 anos

type Body =
  | { action: 'create'; email: string; password: string; full_name: string; is_admin?: boolean }
  | { action: 'set_active'; user_id: string; active: boolean }
  | { action: 'set_admin'; user_id: string; is_admin: boolean }
  | { action: 'set_name'; user_id: string; full_name: string }
  | { action: 'reset_password'; user_id: string; password: string }

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  })
}

const fail = (status: number, error: string) => json(status, { error })

function translateAuthError(message: string) {
  if (/already been registered|already exists/i.test(message)) return 'Já existe um usuário com esse e-mail.'
  if (/password/i.test(message)) return 'Senha inválida: use pelo menos 8 caracteres.'
  if (/email/i.test(message)) return 'E-mail inválido.'
  return message
}

async function requireAdmin(admin: SupabaseClient, req: Request) {
  const token = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '')
  if (!token) return { error: fail(401, 'Sessão ausente. Entre novamente.') }

  const { data: userData, error: userErr } = await admin.auth.getUser(token)
  if (userErr || !userData.user) return { error: fail(401, 'Sessão inválida ou expirada. Entre novamente.') }

  const { data: profile } = await admin
    .from('profiles')
    .select('is_admin, active')
    .eq('id', userData.user.id)
    .single()

  if (!profile?.is_admin || !profile.active) {
    return { error: fail(403, 'Apenas administradores podem gerenciar usuários.') }
  }
  return { callerId: userData.user.id }
}

export async function POST(req: Request) {
  if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
    return fail(500, 'Servidor sem configuração do Supabase (variáveis de ambiente ausentes).')
  }

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  const auth = await requireAdmin(admin, req)
  if ('error' in auth) return auth.error

  let body: Body
  try {
    body = (await req.json()) as Body
  } catch {
    return fail(400, 'Requisição inválida.')
  }

  switch (body.action) {
    case 'create': {
      const email = String(body.email ?? '').trim().toLowerCase()
      const full_name = String(body.full_name ?? '').trim()
      const password = String(body.password ?? '')
      if (!full_name) return fail(400, 'Informe o nome.')
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return fail(400, 'E-mail inválido.')
      if (password.length < 8) return fail(400, 'A senha inicial precisa ter pelo menos 8 caracteres.')

      const { data, error } = await admin.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
        user_metadata: { full_name },
      })
      if (error || !data.user) return fail(400, translateAuthError(error?.message ?? 'Erro ao criar usuário.'))

      // O perfil é criado pelo trigger on_auth_user_created; aqui só ajustamos nome/admin.
      const { error: profErr } = await admin
        .from('profiles')
        .update({ full_name, is_admin: Boolean(body.is_admin) })
        .eq('id', data.user.id)
      if (profErr) return fail(500, 'Usuário criado, mas houve erro ao salvar o perfil: ' + profErr.message)

      return json(200, { ok: true, user_id: data.user.id })
    }

    case 'set_active': {
      if (body.user_id === auth.callerId && !body.active) {
        return fail(400, 'Você não pode desativar a sua própria conta.')
      }
      const { error } = await admin.auth.admin.updateUserById(body.user_id, {
        ban_duration: body.active ? 'none' : BAN_FOREVER,
      })
      if (error) return fail(400, error.message)
      const { error: profErr } = await admin.from('profiles').update({ active: body.active }).eq('id', body.user_id)
      if (profErr) return fail(500, profErr.message)
      return json(200, { ok: true })
    }

    case 'set_admin': {
      if (body.user_id === auth.callerId && !body.is_admin) {
        return fail(400, 'Você não pode remover o seu próprio acesso de administrador.')
      }
      const { error } = await admin.from('profiles').update({ is_admin: body.is_admin }).eq('id', body.user_id)
      if (error) return fail(500, error.message)
      return json(200, { ok: true })
    }

    case 'set_name': {
      const full_name = String(body.full_name ?? '').trim()
      if (!full_name) return fail(400, 'Informe o nome.')
      const { error } = await admin.from('profiles').update({ full_name }).eq('id', body.user_id)
      if (error) return fail(500, error.message)
      return json(200, { ok: true })
    }

    case 'reset_password': {
      if (String(body.password ?? '').length < 8) return fail(400, 'A senha precisa ter pelo menos 8 caracteres.')
      const { error } = await admin.auth.admin.updateUserById(body.user_id, { password: body.password })
      if (error) return fail(400, translateAuthError(error.message))
      return json(200, { ok: true })
    }

    default:
      return fail(400, 'Ação desconhecida.')
  }
}
