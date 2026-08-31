import { useEffect, type ReactNode } from 'react';

export function Modal({
  title,
  onClose,
  children,
  footer,
  wide,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  wide?: boolean;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={wide ? 'modal wide' : 'modal'} role="dialog" aria-label={title}>
        <div className="modal-head">
          <h2>{title}</h2>
          <div className="spacer" />
          <button className="btn ghost sm" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-foot">{footer}</div>}
      </div>
    </div>
  );
}

export function Field({
  label,
  children,
  hint,
}: {
  label: string;
  children: ReactNode;
  hint?: string;
}) {
  return (
    <label className="field">
      <span>
        {label}
        {hint && <em className="dim"> — {hint}</em>}
      </span>
      {children}
    </label>
  );
}

export function Empty({
  title,
  children,
  action,
}: {
  title: string;
  children?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="empty">
      <h3>{title}</h3>
      {children && <p className="tiny">{children}</p>}
      {action && <div style={{ marginTop: 12 }}>{action}</div>}
    </div>
  );
}

export function Dot({ colour }: { colour: string }) {
  return <span className="dot" style={{ background: colour }} />;
}

export function ConfirmButton({
  onConfirm,
  label = 'Delete',
  confirmLabel = 'Really delete?',
}: {
  onConfirm: () => void;
  label?: string;
  confirmLabel?: string;
}) {
  return (
    <button
      className="btn danger sm"
      onClick={(e) => {
        const el = e.currentTarget;
        if (el.dataset.armed === '1') {
          onConfirm();
          return;
        }
        el.dataset.armed = '1';
        el.textContent = confirmLabel;
        window.setTimeout(() => {
          if (el.isConnected) {
            el.dataset.armed = '';
            el.textContent = label;
          }
        }, 3000);
      }}
    >
      {label}
    </button>
  );
}
