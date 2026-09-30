import { downloadIcs, outlookComposeUrl, type InviteEvent } from '../lib/invite'
import { Modal } from './ui'

export function InviteModal({ ev, onClose }: { ev: InviteEvent; onClose: () => void }) {
  return (
    <Modal
      title="Enviar convite"
      onClose={onClose}
      labelledBy="invite-title"
      footer={<button className="btn" onClick={onClose}>Fechar</button>}
    >
      <p style={{ margin: 0 }}>
        Clique em <strong>Abrir no Outlook</strong>: a reunião abre no seu Outlook já preenchida. Confira e clique em <strong>Enviar</strong>. O
        evento entra na sua agenda e o convite vai para os participantes.
      </p>
      <dl className="detail-list">
        <dt>Reunião</dt>
        <dd>{ev.title}</dd>
        <dt>Local</dt>
        <dd>{ev.location}</dd>
        <dt>Convidados</dt>
        <dd>{ev.attendees.length ? ev.attendees.join(', ') : <span className="muted">só você</span>}</dd>
      </dl>
      <div className="inline-actions">
        <a className="btn btn-primary" href={outlookComposeUrl(ev)} target="_blank" rel="noreferrer">
          Abrir no Outlook
        </a>
        <button className="btn" onClick={() => downloadIcs(ev)}>Baixar arquivo .ics</button>
      </div>
      <p className="small muted" style={{ margin: 0 }}>
        O arquivo .ics serve para o Outlook instalado no computador, Google Agenda ou celular.
      </p>
    </Modal>
  )
}
