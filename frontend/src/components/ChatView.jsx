import { useEffect, useRef, useState } from 'react';
import { ArrowUp, Plus, Settings2 } from 'lucide-react';
import SafeMarkdown from './SafeMarkdown';
import RunView from './RunView';
import { Badge, Button, StickerLabel } from '../ui';
import { displayTitle, shortName } from '../lib/format';

const EXAMPLES = [
  'Vale a pena usar SQLite em produção para um app web pequeno?',
  'Quais métricas usar para avaliar um modelo de recomendação em produção?',
  'Como priorizar um backlog de features de AI num produto B2B?',
];

function CouncilSummary({ config, onOpenSettings }) {
  if (!config) return null;
  return (
    <div className="council-summary">
      <span className="council-summary__count">{config.council_models.length} membros</span>
      <span className="council-summary__list">
        {config.council_models.slice(0, 4).map((m) => shortName(m)).join(' · ')}
        {config.council_models.length > 4 && ` +${config.council_models.length - 4}`}
      </span>
      <Badge variant="black">Presidente {shortName(config.chairman_model)}</Badge>
      <Button variant="ghost" size="sm" icon={<Settings2 size={14} strokeWidth={2.5} />} onClick={onOpenSettings}>
        Ajustar
      </Button>
    </div>
  );
}

function Composer({ onSend, disabled, maxChars, autoFocus }) {
  const [text, setText] = useState('');
  const ref = useRef(null);

  useEffect(() => {
    if (autoFocus) ref.current?.focus();
  }, [autoFocus]);

  const submit = (e) => {
    e?.preventDefault();
    const value = text.trim();
    if (!value || disabled) return;
    onSend(value);
    setText('');
  };

  const tooLong = maxChars && text.length > maxChars;

  return (
    <form className="composer" onSubmit={submit}>
      <label htmlFor="question" className="visually-hidden">Sua pergunta para o conselho</label>
      <textarea
        id="question"
        ref={ref}
        className="composer__input"
        placeholder="Pergunte ao conselho… (Enter envia, Shift+Enter quebra linha)"
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey) submit(e);
        }}
        rows={3}
        disabled={disabled}
      />
      <div className="composer__bar">
        <span className={`composer__count ${tooLong ? 'is-over' : ''}`}>
          {text.length.toLocaleString('pt-BR')}{maxChars ? ` / ${maxChars.toLocaleString('pt-BR')}` : ''}
          {tooLong && ' · longa demais'}
        </span>
        <Button type="submit" variant="primary" icon={<ArrowUp size={16} strokeWidth={3} />} disabled={!text.trim() || disabled || tooLong}>
          Consultar
        </Button>
      </div>
    </form>
  );
}

export default function ChatView({ conversation, config, isRunning, onSend, onNew, onOpenSettings }) {
  const endRef = useRef(null);
  const messages = conversation?.messages || [];
  const answered = messages.some((m) => m.role === 'assistant');

  useEffect(() => {
    if (isRunning) endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [isRunning, messages.length]);

  if (messages.length === 0) {
    return (
      <div className="view view--hero">
        <section className="hero">
          <div className="hero__text">
            <div className="hero__eyebrow">Conselho de AI</div>
            <h1 className="hero__title">Uma pergunta.<br />Vários modelos.<br />Um veredito<span className="accent">.</span></h1>
            <p className="hero__sub">
              Cada membro responde sozinho, avalia as respostas dos outros sem saber de quem são, e o presidente
              entrega a síntese. Tudo via Vertex AI.
            </p>
          </div>
          <StickerLabel rotate={-6}>Peer review</StickerLabel>
        </section>

        <div className="ask">
          <CouncilSummary config={config} onOpenSettings={onOpenSettings} />
          <Composer onSend={onSend} disabled={isRunning} maxChars={config?.limits?.max_message_chars} autoFocus />
          <div className="examples">
            {EXAMPLES.map((q) => (
              <button key={q} type="button" className="example" onClick={() => onSend(q)} disabled={isRunning}>
                {q}
              </button>
            ))}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="view">
      <header className="view__head">
        <div>
          <div className="im-eyebrow">Conversa</div>
          <h1 className="view__title">{displayTitle(conversation.title)}</h1>
        </div>
        {answered && !isRunning && (
          <Button variant="secondary" icon={<Plus size={16} strokeWidth={3} />} onClick={onNew}>
            Outra pergunta
          </Button>
        )}
      </header>

      {messages.map((msg, i) =>
        msg.role === 'user' ? (
          <div key={i} className="question">
            <span className="question__label">Você perguntou</span>
            <div className="markdown-content"><SafeMarkdown>{msg.content}</SafeMarkdown></div>
          </div>
        ) : (
          <RunView key={i} msg={msg} pricing={config?.pricing} />
        )
      )}
      <div ref={endRef} />
    </div>
  );
}
