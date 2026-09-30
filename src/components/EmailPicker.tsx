import { useState } from 'react'
import type { Profile } from '../lib/types'

interface Props {
  /** Usuários cadastrados para marcar (só administradores recebem a lista) */
  people?: Profile[]
  picked: string[]
  onPickedChange: (emails: string[]) => void
  extra: string
  onExtraChange: (text: string) => void
  /** Texto de ajuda embaixo do campo de e-mails extras */
  hint?: string
}

/** Escolha de quem recebe o convite: colegas cadastrados + e-mails digitados. */
export function EmailPicker({ people, picked, onPickedChange, extra, onExtraChange, hint }: Props) {
  const [query, setQuery] = useState('')
  const list = (people ?? [])
    .filter((p) => p.active && !p.pending)
    .sort((a, b) => a.full_name.localeCompare(b.full_name, 'pt-BR'))
  const q = normalize(query.trim())
  const shown = q ? list.filter((p) => normalize(`${p.full_name} ${p.email}`).includes(q)) : list

  function toggle(email: string) {
    onPickedChange(picked.includes(email) ? picked.filter((e) => e !== email) : [...picked, email])
  }

  return (
    <>
      {list.length > 0 && (
        <fieldset className="field choice">
          <legend>
            Enviar convite para colegas (opcional){picked.length > 0 && ` · ${picked.length} selecionado${picked.length > 1 ? 's' : ''}`}
          </legend>
          <div className="people-picker">
            {list.length > 6 && (
              <input
                className="input"
                value={query}
                placeholder="Buscar por nome ou e-mail"
                aria-label="Buscar colega"
                onChange={(e) => setQuery(e.target.value)}
              />
            )}
            <ul className="people-list">
              {shown.map((p) => (
                <li key={p.id}>
                  <label className="check">
                    <input type="checkbox" checked={picked.includes(p.email)} onChange={() => toggle(p.email)} />
                    <span className="grow">
                      {p.full_name}
                      <span className="muted small"> · {p.email}</span>
                    </span>
                  </label>
                </li>
              ))}
              {shown.length === 0 && <li className="muted small">Ninguém encontrado.</li>}
            </ul>
            {picked.length > 0 && (
              <button type="button" className="btn btn-sm btn-ghost" onClick={() => onPickedChange([])}>
                Limpar seleção
              </button>
            )}
          </div>
        </fieldset>
      )}

      <label className="field">
        <span>{list.length > 0 ? 'Outros e-mails (opcional)' : 'E-mails para o convite (opcional)'}</span>
        <input
          className="input"
          value={extra}
          placeholder="cliente@email.com, parceiro@empresa.com"
          autoComplete="off"
          onChange={(e) => onExtraChange(e.target.value)}
        />
        <span className="small muted">Separe por vírgula.{hint ? ` ${hint}` : ''}</span>
      </label>
    </>
  )
}

function normalize(s: string) {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
}
