import { useEffect, useRef, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

export function Modal({
  title,
  onClose,
  children,
  footer,
  labelledBy = 'modal-title',
}: {
  title: string
  onClose: () => void
  children: ReactNode
  footer?: ReactNode
  labelledBy?: string
}) {
  const ref = useRef<HTMLDivElement>(null)
  const closeRef = useRef(onClose)
  closeRef.current = onClose

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && closeRef.current()
    document.addEventListener('keydown', onKey)
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    if (!ref.current?.contains(document.activeElement)) {
      ref.current?.querySelector<HTMLElement>('input, select, button.btn-primary, button')?.focus()
    }
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = prev
    }
  }, [])

  // Renderiza direto no <body>: dentro do painel lateral (position: sticky) a grade ficava por cima da janela
  return createPortal(
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" role="dialog" aria-modal="true" aria-labelledby={labelledBy} ref={ref}>
        <div className="modal-head">
          <h2 id={labelledBy}>{title}</h2>
          <button className="btn btn-ghost btn-icon" onClick={onClose} aria-label="Fechar">
            <IconX />
          </button>
        </div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-foot">{footer}</div>}
      </div>
    </div>,
    document.body,
  )
}

export function ConfirmDialog({
  title,
  message,
  confirmLabel,
  busy,
  error,
  onConfirm,
  onCancel,
}: {
  title: string
  message: ReactNode
  confirmLabel: string
  busy?: boolean
  error?: string | null
  onConfirm: () => void
  onCancel: () => void
}) {
  return (
    <Modal
      title={title}
      onClose={onCancel}
      labelledBy="confirm-title"
      footer={
        <>
          <button className="btn" onClick={onCancel} disabled={busy}>
            Voltar
          </button>
          <button className="btn btn-danger-solid" onClick={onConfirm} disabled={busy}>
            {busy ? 'Aguarde…' : confirmLabel}
          </button>
        </>
      }
    >
      <div>{message}</div>
      {error && <div className="alert" role="alert">{error}</div>}
    </Modal>
  )
}

export function Toast({ text, kind, onDone }: { text: string; kind: 'ok' | 'error'; onDone: () => void }) {
  useEffect(() => {
    const t = setTimeout(onDone, kind === 'error' ? 6000 : 3200)
    return () => clearTimeout(t)
  }, [text, kind, onDone])
  return (
    <div className={`toast ${kind === 'error' ? 'is-error' : ''}`} role="status" aria-live="polite">
      {text}
    </div>
  )
}

const svg = { width: 18, height: 18, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round' } as const

export const IconX = () => (
  <svg {...svg} aria-hidden="true"><path d="M18 6 6 18M6 6l12 12" /></svg>
)
export const IconLeft = () => (
  <svg {...svg} aria-hidden="true"><path d="m15 18-6-6 6-6" /></svg>
)
export const IconRight = () => (
  <svg {...svg} aria-hidden="true"><path d="m9 18 6-6-6-6" /></svg>
)
export const IconSun = () => (
  <svg {...svg} aria-hidden="true"><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41" /></svg>
)
export const IconMoon = () => (
  <svg {...svg} aria-hidden="true"><path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z" /></svg>
)
export const IconLogout = () => (
  <svg {...svg} aria-hidden="true"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9" /></svg>
)
export const IconSettings = () => (
  <svg {...svg} aria-hidden="true"><path d="M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z" /><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1Z" /></svg>
)
