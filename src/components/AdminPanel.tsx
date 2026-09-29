import { useEffect, useState, type FormEvent } from 'react'
import { supabase } from '../lib/supabase'
import { friendlyError } from '../lib/errors'
import { adminApi } from '../lib/adminApi'
import type { Profile, Room } from '../lib/types'
import { ConfirmDialog, Modal } from './ui'

interface Props {
  rooms: Room[]
  profiles: Profile[]
  meId: string
  onBack: () => void
  notify: (text: string, kind?: 'ok' | 'error') => void
  reload: () => void
}

export function AdminPanel({ rooms, profiles, meId, onBack, notify, reload }: Props) {
  const [tab, setTab] = useState<'rooms' | 'users'>('rooms')
  return (
    <div>
      <div className="admin-head">
        <h1>Administração</h1>
        <div className="tabs" role="tablist">
          <button role="tab" aria-selected={tab === 'rooms'} className={`tab ${tab === 'rooms' ? 'is-active' : ''}`} onClick={() => setTab('rooms')}>
            Salas
          </button>
          <button role="tab" aria-selected={tab === 'users'} className={`tab ${tab === 'users' ? 'is-active' : ''}`} onClick={() => setTab('users')}>
            Usuários
          </button>
        </div>
        <button className="btn" onClick={onBack}>Voltar à agenda</button>
      </div>
      {tab === 'rooms' ? (
        <RoomsAdmin rooms={rooms} notify={notify} reload={reload} />
      ) : (
        <UsersAdmin profiles={profiles} meId={meId} notify={notify} reload={reload} />
      )}
    </div>
  )
}

/* ------------------------------ Salas ------------------------------ */

function RoomsAdmin({ rooms, notify, reload }: Pick<Props, 'rooms' | 'notify' | 'reload'>) {
  const [newName, setNewName] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [toDelete, setToDelete] = useState<{ room: Room; count: number } | null>(null)
  const [deleteErr, setDeleteErr] = useState<string | null>(null)

  async function add(e: FormEvent) {
    e.preventDefault()
    const name = newName.trim()
    if (!name) return setError('Informe o nome da sala.')
    setBusy(true)
    setError(null)
    const position = rooms.reduce((m, r) => Math.max(m, r.position), 0) + 1
    const { error } = await supabase.from('rooms').insert({ name, position })
    setBusy(false)
    if (error) return setError(friendlyError(error))
    setNewName('')
    notify(`Sala "${name}" criada.`)
    reload()
  }

  async function askDelete(room: Room) {
    setDeleteErr(null)
    const { count } = await supabase
      .from('bookings')
      .select('id', { count: 'exact', head: true })
      .eq('room_id', room.id)
      .gt('ends_at', new Date().toISOString())
    setToDelete({ room, count: count ?? 0 })
  }

  async function confirmDelete() {
    if (!toDelete) return
    setBusy(true)
    const { data, error } = await supabase.from('rooms').delete().eq('id', toDelete.room.id).select('id')
    setBusy(false)
    if (error) return setDeleteErr(friendlyError(error))
    if (!data?.length) return setDeleteErr('Você não tem permissão para excluir salas.')
    notify(`Sala "${toDelete.room.name}" excluída.`)
    setToDelete(null)
    reload()
  }

  const n = toDelete?.count ?? 0

  return (
    <div className="admin-grid">
      <section className="card admin-section">
        <h2>Salas ({rooms.length})</h2>
        <ul className="admin-list">
          {rooms.map((r) => (
            <RoomRow key={r.id} room={r} onDelete={() => askDelete(r)} notify={notify} reload={reload} />
          ))}
        </ul>
        {rooms.length === 0 && <p className="muted">Nenhuma sala cadastrada.</p>}
      </section>

      <section className="card admin-section">
        <h2>Nova sala</h2>
        <form className="stack" onSubmit={add}>
          <label className="field">
            <span>Nome</span>
            <input className="input" value={newName} maxLength={60} onChange={(e) => setNewName(e.target.value)} placeholder="Ex.: Sala 5" />
          </label>
          {error && <div className="alert" role="alert">{error}</div>}
          <button className="btn btn-primary" disabled={busy}>Criar sala</button>
        </form>
      </section>

      {toDelete && (
        <ConfirmDialog
          title={`Excluir "${toDelete.room.name}"?`}
          message={
            n > 0 ? (
              <>
                Esta sala tem <strong>{n === 1 ? '1 reserva futura' : `${n} reservas futuras`}</strong>, que{' '}
                {n === 1 ? 'será cancelada' : 'serão canceladas'} junto com ela. Essa ação não pode ser desfeita.
              </>
            ) : (
              'A sala e todo o seu histórico de reservas serão removidos. Essa ação não pode ser desfeita.'
            )
          }
          confirmLabel="Excluir sala"
          busy={busy}
          error={deleteErr}
          onConfirm={confirmDelete}
          onCancel={() => setToDelete(null)}
        />
      )}
    </div>
  )
}

function RoomRow({ room, onDelete, notify, reload }: { room: Room; onDelete: () => void } & Pick<Props, 'notify' | 'reload'>) {
  const [name, setName] = useState(room.name)
  const [busy, setBusy] = useState(false)
  useEffect(() => setName(room.name), [room.name])
  const dirty = name.trim() !== room.name && name.trim() !== ''

  async function save(e: FormEvent) {
    e.preventDefault()
    if (!dirty) return
    setBusy(true)
    const { data, error } = await supabase.from('rooms').update({ name: name.trim() }).eq('id', room.id).select('id')
    setBusy(false)
    if (error) return notify(friendlyError(error), 'error')
    if (!data?.length) return notify('Você não tem permissão para renomear salas.', 'error')
    notify('Sala renomeada.')
    reload()
  }

  return (
    <li>
      <form onSubmit={save} className="grow" style={{ display: 'flex', gap: 8 }}>
        <input className="input" value={name} maxLength={60} onChange={(e) => setName(e.target.value)} aria-label={`Nome da ${room.name}`} />
        {dirty && <button className="btn btn-primary" disabled={busy}>Salvar</button>}
      </form>
      <button className="btn btn-danger" onClick={onDelete}>Excluir</button>
    </li>
  )
}

/* ----------------------------- Usuários ----------------------------- */

function randomPassword() {
  const chars = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  const arr = new Uint32Array(12)
  crypto.getRandomValues(arr)
  return Array.from(arr, (n) => chars[n % chars.length]).join('')
}

const EMPTY_FORM = { full_name: '', email: '', password: '', is_admin: false }

function UsersAdmin({ profiles, meId, notify, reload }: Pick<Props, 'profiles' | 'meId' | 'notify' | 'reload'>) {
  const [form, setForm] = useState(EMPTY_FORM)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [created, setCreated] = useState<{ email: string; password: string } | null>(null)
  const [pending, setPending] = useState<string | null>(null)
  const [pwdFor, setPwdFor] = useState<Profile | null>(null)

  const sorted = [...profiles].sort(
    (a, b) => Number(b.active) - Number(a.active) || a.full_name.localeCompare(b.full_name, 'pt-BR'),
  )

  async function create(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    setCreated(null)
    const err = await adminApi({ action: 'create', ...form })
    setBusy(false)
    if (err) return setError(err)
    setCreated({ email: form.email.trim().toLowerCase(), password: form.password })
    setForm(EMPTY_FORM)
    notify('Usuário criado.')
    reload()
  }

  async function act(p: Profile, body: Record<string, unknown>, okMsg: string) {
    setPending(p.id)
    const err = await adminApi({ user_id: p.id, ...body })
    setPending(null)
    if (err) return notify(err, 'error')
    notify(okMsg)
    reload()
  }

  return (
    <div className="admin-grid">
      <section className="card admin-section">
        <h2>Usuários ({profiles.filter((p) => p.active).length} ativos)</h2>
        <ul className="admin-list">
          {sorted.map((p) => {
            const me = p.id === meId
            const dis = pending === p.id
            return (
              <li key={p.id}>
                <div className="grow">
                  <div className="user-name">
                    {p.full_name}
                    {me && <span className="badge badge-you">você</span>}
                    {p.is_admin && <span className="badge badge-admin">Admin</span>}
                    {!p.active && <span className="badge badge-off">Desativado</span>}
                  </div>
                  <div className="muted small">{p.email}</div>
                </div>
                <div className="inline-actions">
                  {!me && p.active && (
                    <button
                      className="btn btn-sm"
                      disabled={dis}
                      onClick={() =>
                        act(p, { action: 'set_admin', is_admin: !p.is_admin }, p.is_admin ? 'Acesso de admin removido.' : 'Usuário agora é administrador.')
                      }
                    >
                      {p.is_admin ? 'Remover admin' : 'Tornar admin'}
                    </button>
                  )}
                  <button className="btn btn-sm" disabled={dis} onClick={() => setPwdFor(p)}>
                    Nova senha
                  </button>
                  {!me && (
                    <button
                      className={`btn btn-sm ${p.active ? 'btn-danger' : ''}`}
                      disabled={dis}
                      onClick={() => act(p, { action: 'set_active', active: !p.active }, p.active ? 'Usuário desativado.' : 'Usuário reativado.')}
                    >
                      {p.active ? 'Desativar' : 'Reativar'}
                    </button>
                  )}
                </div>
              </li>
            )
          })}
        </ul>
      </section>

      <section className="card admin-section">
        <h2>Novo usuário</h2>
        <form className="stack" onSubmit={create}>
          <label className="field">
            <span>Nome</span>
            <input className="input" value={form.full_name} onChange={(e) => setForm({ ...form, full_name: e.target.value })} required />
          </label>
          <label className="field">
            <span>E-mail</span>
            <input
              className="input"
              type="email"
              value={form.email}
              onChange={(e) => setForm({ ...form, email: e.target.value })}
              required
              autoComplete="off"
            />
          </label>
          <label className="field">
            <span>Senha inicial (mín. 8 caracteres)</span>
            <div style={{ display: 'flex', gap: 6 }}>
              <input
                className="input"
                value={form.password}
                onChange={(e) => setForm({ ...form, password: e.target.value })}
                required
                minLength={8}
                autoComplete="new-password"
              />
              <button type="button" className="btn" onClick={() => setForm({ ...form, password: randomPassword() })}>
                Gerar
              </button>
            </div>
          </label>
          <label className="check">
            <input type="checkbox" checked={form.is_admin} onChange={(e) => setForm({ ...form, is_admin: e.target.checked })} />
            Administrador
          </label>
          {error && <div className="alert" role="alert">{error}</div>}
          <button className="btn btn-primary" disabled={busy}>
            {busy ? 'Criando…' : 'Criar usuário'}
          </button>
          {created && (
            <p className="small muted" style={{ margin: 0 }}>
              Envie ao colega: e-mail <strong>{created.email}</strong> e senha <strong>{created.password}</strong>. A senha não
              será mostrada novamente.
            </p>
          )}
        </form>
      </section>

      {pwdFor && <PasswordModal profile={pwdFor} onClose={() => setPwdFor(null)} notify={notify} />}
    </div>
  )
}

function PasswordModal({ profile, onClose, notify }: { profile: Profile; onClose: () => void; notify: Props['notify'] }) {
  const [password, setPassword] = useState(randomPassword)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function save(e: FormEvent) {
    e.preventDefault()
    if (password.length < 8) return setError('A senha precisa ter pelo menos 8 caracteres.')
    setBusy(true)
    const err = await adminApi({ action: 'reset_password', user_id: profile.id, password })
    setBusy(false)
    if (err) return setError(err)
    notify(`Senha de ${profile.full_name} redefinida.`)
    onClose()
  }

  return (
    <Modal
      title={`Nova senha — ${profile.full_name}`}
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose} disabled={busy}>
            Cancelar
          </button>
          <button className="btn btn-primary" form="pwd-form" disabled={busy}>
            {busy ? 'Salvando…' : 'Definir senha'}
          </button>
        </>
      }
    >
      <form id="pwd-form" className="stack" onSubmit={save}>
        <label className="field">
          <span>Nova senha (anote e envie ao colega)</span>
          <input className="input" value={password} onChange={(e) => setPassword(e.target.value)} minLength={8} required />
        </label>
        {error && <div className="alert" role="alert">{error}</div>}
      </form>
    </Modal>
  )
}
