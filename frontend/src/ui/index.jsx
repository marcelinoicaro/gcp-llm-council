/**
 * UI primitives from a personal design system
 * (Button, Badge, Card, Switch, Checkbox) plus an original app mark, adapted to CSS
 * classes so the app can theme them in one stylesheet (ui.css).
 */
import './ui.css';

export function Button({ variant = 'primary', size = 'md', icon, children, className = '', ...rest }) {
  return (
    <button type="button" className={`im-btn im-btn--${variant} im-btn--${size} ${className}`} {...rest}>
      {icon}
      {children && <span>{children}</span>}
    </button>
  );
}

export function IconButton({ label, children, className = '', ...rest }) {
  return (
    <button type="button" className={`im-icon-btn ${className}`} aria-label={label} title={label} {...rest}>
      {children}
    </button>
  );
}

export function Badge({ variant = 'neon', children, className = '' }) {
  return <span className={`im-badge im-badge--${variant} ${className}`}>{children}</span>;
}

export function Card({ tone = 'dark', eyebrow, title, actions, children, className = '', ...rest }) {
  return (
    <section className={`im-card im-card--${tone} ${className}`} {...rest}>
      {(eyebrow || title || actions) && (
        <header className="im-card__head">
          <div>
            {eyebrow && <div className="im-eyebrow">{eyebrow}</div>}
            {title && <h3 className="im-card__title">{title}</h3>}
          </div>
          {actions && <div className="im-card__actions">{actions}</div>}
        </header>
      )}
      {children}
    </section>
  );
}

export function Switch({ checked, onChange, label, disabled = false }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      className={`im-switch ${checked ? 'is-on' : ''}`}
      onClick={() => onChange?.(!checked)}
    >
      <span className="im-switch__track">
        <span className="im-switch__thumb" />
        <span className="im-switch__text">{checked ? 'ON' : 'OFF'}</span>
      </span>
      {label && <span className="im-switch__label">{label}</span>}
    </button>
  );
}

export function Checkbox({ checked, onChange, label, disabled = false }) {
  return (
    <label className={`im-check ${checked ? 'is-on' : ''} ${disabled ? 'is-disabled' : ''}`}>
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange?.(e.target.checked)}
      />
      <span className="im-check__dot" aria-hidden="true" />
      {label && <span className="im-check__label">{label}</span>}
    </label>
  );
}

/** App mark: an original SVG (neon disc, "LC" for GCP LLM Council). */
export function BrandMark({ size = 40 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 40 40" className="im-mark" role="img" aria-label="GCP LLM Council">
      <circle cx="20" cy="20" r="19" fill="var(--im-neon)" stroke="var(--im-black)" strokeWidth="2" />
      <text
        x="20"
        y="25.5"
        textAnchor="middle"
        fontFamily="var(--font-primary)"
        fontWeight="900"
        fontSize="15"
        letterSpacing="-0.5"
        fill="var(--im-black)"
      >
        LC
      </text>
    </svg>
  );
}

/** Sticker-style label drawn in CSS: thick outline, neon fill, hard shadow, slight tilt. */
export function StickerLabel({ children, rotate = 6 }) {
  return (
    <span className="im-sticker-label" style={{ transform: `rotate(${rotate}deg)` }} aria-hidden="true">
      {children}
    </span>
  );
}

export function Spinner({ size = 16 }) {
  return <span className="im-spinner" style={{ width: size, height: size }} aria-hidden="true" />;
}
