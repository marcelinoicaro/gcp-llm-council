import { useState } from 'react';
import { BarChart3, MessagesSquare, Plus, Settings2, Trash2 } from 'lucide-react';
import { BrandMark, Button, IconButton } from '../ui';
import { displayTitle, formatDate } from '../lib/format';

const NAV = [
  { id: 'chat', label: 'Conselho', Icon: MessagesSquare },
  { id: 'settings', label: 'Configuração', Icon: Settings2 },
  { id: 'dashboard', label: 'Painel', Icon: BarChart3 },
];

export default function Sidebar({ view, onNavigate, conversations, currentId, onSelect, onNew, onDelete, disabled }) {
  const [confirming, setConfirming] = useState(null);

  return (
    <aside className="sidebar">
      <div className="sidebar__brand">
        <BrandMark size={44} />
        <div className="sidebar__product">
          <span className="sidebar__product-name">GCP LLM COUNCIL</span>
          <span className="sidebar__product-tag">Muitos modelos. Um veredito.</span>
        </div>
      </div>

      <nav className="sidebar__nav" aria-label="Seções">
        {NAV.map(({ id, label, ...item }) => {
          // Capitalized so the lint config (no JSX plugin) treats it as used.
          const NavIcon = item.Icon;
          return (
          <button
            key={id}
            type="button"
            className={`nav-item ${view === id ? 'is-active' : ''}`}
            aria-current={view === id ? 'page' : undefined}
            onClick={() => onNavigate(id)}
          >
            <NavIcon size={18} strokeWidth={2.5} />
            <span>{label}</span>
          </button>
          );
        })}
      </nav>

      <Button
        variant="primary"
        icon={<Plus size={16} strokeWidth={3} />}
        onClick={onNew}
        disabled={disabled}
        className="sidebar__new"
      >
        Nova pergunta
      </Button>

      <div className="sidebar__section-title">Histórico</div>
      <ul className="conversation-list">
        {conversations.length === 0 && <li className="conversation-list__empty">Nenhuma conversa ainda.</li>}
        {conversations.map((c) => (
          <li key={c.id} className={`conversation-item ${c.id === currentId ? 'is-active' : ''}`}>
            {confirming === c.id ? (
              <div className="conversation-item__confirm">
                <span>Excluir?</span>
                <Button size="sm" variant="danger" onClick={() => { setConfirming(null); onDelete(c.id); }}>
                  Sim
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setConfirming(null)}>
                  Não
                </Button>
              </div>
            ) : (
              <>
                <button type="button" className="conversation-item__open" onClick={() => onSelect(c.id)}>
                  <span className="conversation-item__title">{displayTitle(c.title)}</span>
                  <span className="conversation-item__meta">
                    {formatDate(c.created_at)} · {c.message_count ? 'respondida' : 'vazia'}
                  </span>
                </button>
                <IconButton
                  label="Excluir conversa"
                  className="conversation-item__delete"
                  onClick={() => setConfirming(c.id)}
                  disabled={disabled}
                >
                  <Trash2 size={15} strokeWidth={2.5} />
                </IconButton>
              </>
            )}
          </li>
        ))}
      </ul>
    </aside>
  );
}
