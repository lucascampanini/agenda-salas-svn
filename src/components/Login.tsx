import { useState, type FormEvent } from 'react'
import { supabase } from '../lib/supabase'
import { friendlyError } from '../lib/errors'

export function Login({ notice }: { notice?: string | null }) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(notice ?? null)

  async function submit(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password })
    setBusy(false)
    if (error) setError(friendlyError(error))
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
        <h1>Entrar</h1>
        <p className="muted small" style={{ margin: 0 }}>Use o e-mail e a senha fornecidos pelo administrador.</p>
        <form onSubmit={submit}>
          <label className="field">
            <span>E-mail</span>
            <input className="input" type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required autoFocus />
          </label>
          <label className="field">
            <span>Senha</span>
            <input className="input" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
          </label>
          {error && <div className="alert" role="alert">{error}</div>}
          <button className="btn btn-primary" disabled={busy}>{busy ? 'Entrando…' : 'Entrar'}</button>
          <p className="muted small" style={{ margin: 0, textAlign: 'center' }}>
            Esqueceu a senha ou precisa de acesso? Fale com um administrador.
          </p>
        </form>
      </div>
    </div>
  )
}
