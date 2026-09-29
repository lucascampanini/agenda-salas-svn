interface ErrLike {
  code?: string
  message?: string
  status?: number
}

/** Traduz erros do Supabase/Postgres para mensagens claras em português. */
export function friendlyError(err: unknown): string {
  const e = (err ?? {}) as ErrLike
  const msg = e.message ?? ''

  if (e.code === '23P01') return 'Esse horário acabou de ser reservado por outra pessoa. Escolha outro.'
  if (e.code === '23505') return 'Já existe uma sala com esse nome.'
  if (e.code === '42501') return 'Você não tem permissão para fazer isso.'
  if (e.code === '23514') return 'Dados inválidos. Confira os campos e tente de novo.'
  // Exceções das regras de negócio (trigger validate_booking) já vêm em português
  if (e.code === 'P0001' && msg) return msg

  if (/invalid login credentials/i.test(msg)) return 'E-mail ou senha incorretos.'
  if (/banned/i.test(msg)) return 'Seu acesso está desativado. Fale com um administrador.'
  if (/email not confirmed/i.test(msg)) return 'E-mail ainda não confirmado. Fale com um administrador.'
  if (/failed to fetch|network/i.test(msg)) return 'Sem conexão com o servidor. Verifique sua internet e tente de novo.'
  if (/jwt expired/i.test(msg)) return 'Sua sessão expirou. Entre novamente.'

  return msg ? `Não foi possível concluir: ${msg}` : 'Algo deu errado. Tente de novo.'
}
