import { useState, type FormEvent } from 'react'
import { FunctionsHttpError } from '@supabase/supabase-js'
import { supabase } from '../lib/supabase'

/** Tela aberta pelo link de convite (?convite=CÓDIGO). */
export function InviteSignup({ code, onDone }: { code: string; onDone: () => void }) {
  const [form, setForm] = useState({ full_name: '', email: '', password: '', confirm: '' })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [sent, setSent] = useState(false)

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (!form.full_name.trim()) return setError('Informe o seu nome.')
    if (form.password.length < 8) return setError('A senha precisa ter pelo menos 8 caracteres.')
    if (form.password !== form.confirm) return setError('As duas senhas não são iguais.')
    setBusy(true)
    setError(null)
    const { error } = await supabase.functions.invoke('admin-users', {
      body: { action: 'signup_with_invite', code, full_name: form.full_name, email: form.email, password: form.password },
    })
    setBusy(false)
    if (error) {
      if (error instanceof FunctionsHttpError) {
        const json = (await error.context.json().catch(() => ({}))) as { error?: string }
        return setError(json.error ?? 'Não foi possível concluir o cadastro.')
      }
      return setError('Sem conexão com o servidor. Verifique sua internet e tente de novo.')
    }
    setSent(true)
  }

  return (
    <div className="login-wrap">
      <div className="card login">
        <div className="brand">
          <div className="brand-mark">SVN</div>
          <div>
            <div className="brand-name">Agenda de Salas</div>
            <div className="brand-sub">SVN Investimentos · Campo Grande/MS</div>
          </div>
        </div>

        {sent ? (
          <>
            <h1>Cadastro enviado ✓</h1>
            <p className="muted" style={{ margin: '8px 0 18px' }}>
              Agora é só aguardar: um administrador vai aprovar o seu acesso. Depois disso, entre com o e-mail{' '}
              <strong>{form.email.trim().toLowerCase()}</strong> e a senha que você escolheu.
            </p>
            <button className="btn btn-primary" style={{ width: '100%', height: 42 }} onClick={onDone}>
              Ir para a tela de entrada
            </button>
          </>
        ) : (
          <>
            <h1>Criar meu acesso</h1>
            <p className="muted small" style={{ margin: 0 }}>
              Preencha seus dados. Seu acesso será liberado depois da aprovação de um administrador.
            </p>
            <form onSubmit={submit}>
              <label className="field">
                <span>Nome (como vai aparecer nas reservas)</span>
                <input className="input" value={form.full_name} maxLength={80} onChange={(e) => setForm({ ...form, full_name: e.target.value })} required autoFocus />
              </label>
              <label className="field">
                <span>E-mail</span>
                <input className="input" type="email" autoComplete="username" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} required />
              </label>
              <label className="field">
                <span>Senha (mín. 8 caracteres)</span>
                <input className="input" type="password" autoComplete="new-password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} required minLength={8} />
              </label>
              <label className="field">
                <span>Repita a senha</span>
                <input className="input" type="password" autoComplete="new-password" value={form.confirm} onChange={(e) => setForm({ ...form, confirm: e.target.value })} required />
              </label>
              {error && <div className="alert" role="alert">{error}</div>}
              <button className="btn btn-primary" disabled={busy}>{busy ? 'Enviando…' : 'Enviar cadastro'}</button>
              <p className="muted small" style={{ margin: 0, textAlign: 'center' }}>
                Já tem acesso? <a href={import.meta.env.BASE_URL} style={{ color: 'inherit' }} onClick={(e) => { e.preventDefault(); onDone() }}>Entrar</a>
              </p>
            </form>
          </>
        )}
      </div>
    </div>
  )
}
