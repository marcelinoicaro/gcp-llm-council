import { useEffect, useMemo, useRef, useState } from 'react';
import { Check, Copy, Crown, Loader2, X } from 'lucide-react';
import SafeMarkdown from './SafeMarkdown';
import { LatencyBars, PeerMatrix, RankDotPlot } from './charts';
import { Badge, Card, IconButton, Spinner } from '../ui';
import { formatMs, formatNumber, shortName } from '../lib/format';
import { costOf, formatUsd, sumCosts } from '../lib/cost';

const STAGES = [
  { id: 'stage1', n: 1, label: 'Respostas', hint: 'Cada membro responde sozinho' },
  { id: 'stage2', n: 2, label: 'Avaliação', hint: 'Revisão anônima entre pares' },
  { id: 'stage3', n: 3, label: 'Síntese', hint: 'O presidente consolida' },
];
const ORDER = { starting: 0, stage1: 1, stage2: 2, stage3: 3, done: 4, error: 4 };

function useNow(active) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return undefined;
    const t = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(t);
  }, [active]);
  return now;
}

/** Members per stage, from the live stream or from the stored metadata. */
function memberRows(msg) {
  const rows = { stage1: [], stage2: [], stage3: [] };
  if (msg.live && msg.live.stage !== 'done') {
    const council = msg.live.council || [];
    const chairman = msg.live.chairman;
    for (const stage of ['stage1', 'stage2', 'stage3']) {
      const models = stage === 'stage3' ? (chairman ? [chairman] : []) : council;
      rows[stage] = models.map((model) => ({ model, ...(msg.live.members[`${stage}:${model}`] || { status: 'pending' }) }));
    }
    return rows;
  }
  for (const m of msg.metadata?.members || []) {
    rows[m.stage]?.push({ ...m, status: m.ok ? 'done' : 'failed' });
  }
  return rows;
}

function stageState(stageId, msg, rows) {
  const s = msg.live?.stage;
  if (!msg.live || s === 'done') return 'done';
  if (s === 'error') {
    if (rows[stageId].some((r) => r.status === 'running')) return 'failed';
    return rows[stageId].some((r) => r.status !== 'pending') ? 'done' : 'pending';
  }
  const current = ORDER[s];
  const mine = ORDER[stageId];
  if (current > mine) return 'done';
  if (current === mine) return 'running';
  return 'pending';
}

function StatusIcon({ status }) {
  if (status === 'running') return <Loader2 size={14} strokeWidth={3} className="spin" aria-label="em andamento" />;
  if (status === 'done') return <Check size={14} strokeWidth={3} aria-label="concluído" />;
  if (status === 'failed') return <X size={14} strokeWidth={3} aria-label="falhou" />;
  return <span className="dot-pending" aria-label="aguardando" />;
}

function RunProgress({ msg, onOpenMember, pricing }) {
  const live = msg.live && msg.live.stage !== 'done' && msg.live.stage !== 'error';
  const now = useNow(live);
  const rows = memberRows(msg);
  const [focus, setFocus] = useState(null);
  const activeStage = focus || (live && msg.live.stage.startsWith('stage') ? msg.live.stage : 'stage1');

  const elapsed = live ? now - msg.live.startedAt : msg.metadata?.duration_ms;
  const stageCost = (id) => sumCosts(rows[id].filter((r) => r.status === 'done').map((r) => costOf(r, pricing)));
  const totalCost = sumCosts(['stage1', 'stage2', 'stage3'].flatMap((id) =>
    rows[id].filter((r) => r.status === 'done').map((r) => costOf(r, pricing))));
  const durations = msg.metadata?.durations_ms || {};
  const memberCount = (msg.live?.council || msg.metadata?.council || []).length;

  return (
    <Card tone="sunken" className="progress">
      <div className="progress__top">
        <div>
          <div className="im-eyebrow">{live ? 'O conselho está reunido' : 'Execução'}</div>
          <div className="progress__summary">
            <span className="progress__elapsed">{formatMs(elapsed)}</span>
            <span className="progress__cost" title="Estimativa: tokens de entrada, saída e raciocínio × preço do Vertex AI">
              ≈ {formatUsd(totalCost.total)}{!totalCost.complete && '+'}
            </span>
            <span className="progress__meta">
              {memberCount} membros
              {(msg.live?.chairman || msg.metadata?.chairman) && (
                <> · presidente <strong>{shortName(msg.live?.chairman || msg.metadata?.chairman)}</strong></>
              )}
            </span>
          </div>
        </div>
        {live && <Badge variant="neon"><Spinner size={10} /> ao vivo</Badge>}
        {msg.live?.stage === 'error' && <Badge variant="danger">falhou</Badge>}
      </div>

      <ol className="stepper">
        {STAGES.map((s) => {
          const state = stageState(s.id, msg, rows);
          const doneCount = rows[s.id].filter((r) => r.status === 'done').length;
          const failCount = rows[s.id].filter((r) => r.status === 'failed').length;
          return (
            <li key={s.id} className={`step is-${state} ${activeStage === s.id ? 'is-focus' : ''}`}>
              <button type="button" className="step__btn" onClick={() => setFocus(s.id)} aria-pressed={activeStage === s.id}>
                <span className="step__circle">{state === 'done' ? <Check size={16} strokeWidth={3.5} /> : s.n}</span>
                <span className="step__text">
                  <span className="step__label">{s.label}</span>
                  <span className="step__hint">
                    {rows[s.id].length ? `${doneCount}/${rows[s.id].length}` : s.hint}
                    {failCount > 0 && ` · ${failCount} falha${failCount > 1 ? 's' : ''}`}
                    {durations[s.id] != null && ` · ${formatMs(durations[s.id])}`}
                    {doneCount > 0 && ` · ${formatUsd(stageCost(s.id).total)}`}
                  </span>
                </span>
              </button>
            </li>
          );
        })}
      </ol>

      {rows[activeStage].length > 0 && (
        <div className="members">
          {rows[activeStage].map((r) => {
            const openable = r.status === 'done' && activeStage !== 'stage3';
            const Tag = openable ? 'button' : 'div';
            return (
              <Tag
                key={r.model}
                type={openable ? 'button' : undefined}
                className={`member is-${r.status} ${openable ? 'is-openable' : ''}`}
                title={openable ? `Ver ${activeStage === 'stage1' ? 'a resposta' : 'a avaliação'} de ${r.model}` : r.model}
                onClick={openable ? () => onOpenMember(activeStage, r.model) : undefined}
              >
                <span className="member__icon"><StatusIcon status={r.status} /></span>
                <span className="member__name">{shortName(r.model)}</span>
                <span className="member__time">
                  {r.status === 'running' && r.startedAt ? formatMs(now - r.startedAt) : r.latency_ms != null ? formatMs(r.latency_ms) : ''}
                  {r.status === 'done' && (
                    <span className="member__cost">{costOf(r, pricing) == null ? 'sem preço' : formatUsd(costOf(r, pricing))}</span>
                  )}
                </span>
              </Tag>
            );
          })}
        </div>
      )}

      <p className="cost-note">
        Custo estimado com preços do Vertex AI{pricing?.date ? ` (${pricing.date.split('-').reverse().join('/')})` : ''}, endpoint global.
        Raciocínio conta como saída. Pode diferir da fatura.
      </p>

      {!live && rows[activeStage].some((r) => r.latency_ms != null) && (
        <details className="progress__details">
          <summary>Latência por membro nesta etapa</summary>
          <LatencyBars rows={[...rows[activeStage]].sort((a, b) => (a.latency_ms ?? 1e12) - (b.latency_ms ?? 1e12))} />
        </details>
      )}
    </Card>
  );
}

function UsageBadges({ data, pricing }) {
  const u = data.usage || {};
  const cost = costOf(data, pricing);
  return (
    <>
      {data.latency_ms != null && <Badge variant="muted">{formatMs(data.latency_ms)}</Badge>}
      {u.input_tokens != null && (
        <span className="usage" title="Tokens de entrada · saída · raciocínio">
          {formatNumber(u.input_tokens)} entrada · {formatNumber(u.output_tokens)} saída
          {u.reasoning_tokens ? ` · ${formatNumber(u.reasoning_tokens)} raciocínio` : ''}
        </span>
      )}
      <Badge variant="outline">{cost == null ? 'sem preço' : `≈ ${formatUsd(cost)}`}</Badge>
    </>
  );
}

function deAnonymize(text, labelToModel) {
  if (!labelToModel) return text;
  let result = text;
  Object.entries(labelToModel).forEach(([label, model]) => {
    result = result.replace(new RegExp(`\\b${label}\\b`, 'g'), `**${shortName(model)}**`);
  });
  return result;
}

/**
 * Tabs over council members. Members still working show a spinner and can't
 * be opened yet; finished ones open as soon as their output arrives.
 */
function MemberTabs({ items, activeKey, onSelect, render, label, pendingText }) {
  const available = items.filter((it) => it.data);
  const current = items.find((it) => it.key === activeKey && it.data) || available[0];
  return (
    <div className="tabs-block">
      <div className="tabs" role="tablist" aria-label={label}>
        {items.map((it) => {
          const selected = current?.key === it.key;
          return (
            <button
              key={it.key}
              type="button"
              role="tab"
              aria-selected={selected}
              disabled={!it.data}
              className={`tab is-${it.status} ${selected ? 'is-active' : ''}`}
              onClick={() => onSelect(it.key)}
              title={it.status === 'running' ? 'Ainda trabalhando' : it.status === 'failed' ? 'Falhou' : it.key}
            >
              {it.status === 'running' && <Loader2 size={12} strokeWidth={3} className="spin" aria-hidden="true" />}
              {it.status === 'failed' && <X size={12} strokeWidth={3} aria-hidden="true" />}
              {it.label}
            </button>
          );
        })}
      </div>
      <div className="tab-panel" role="tabpanel">
        {current ? render(current) : <p className="pending-text"><Spinner /> {pendingText}</p>}
      </div>
    </div>
  );
}

function FinalAnswer({ stage3, pricing }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(stage3.response);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard blocked */
    }
  };
  const failed = stage3.model === 'error' || stage3.response?.startsWith('Error:');
  return (
    <Card
      tone="black"
      className="final"
      eyebrow="Veredito do conselho"
      title="Resposta final"
      actions={(
        <>
          <Badge variant="black"><Crown size={12} strokeWidth={3} /> {shortName(stage3.model)}</Badge>
          {costOf(stage3, pricing) != null && <Badge variant="outline">≈ {formatUsd(costOf(stage3, pricing))}</Badge>}
          <IconButton label={copied ? 'Copiado' : 'Copiar resposta'} onClick={copy}>
            {copied ? <Check size={16} strokeWidth={2.5} /> : <Copy size={16} strokeWidth={2.5} />}
          </IconButton>
        </>
      )}
    >
      {failed ? (
        <p className="error-text">O presidente não conseguiu gerar a síntese. Veja as respostas individuais abaixo.</p>
      ) : (
        <div className="markdown-content final__body"><SafeMarkdown>{stage3.response}</SafeMarkdown></div>
      )}
    </Card>
  );
}

/** Items for one stage: final results when stored, else partial outputs + member status. */
function stageItems(msg, stage) {
  const final = msg[stage];
  const live = msg.live && msg.live.stage !== 'done' ? msg.live : null;
  if (!live) {
    return (final || []).map((r) => ({ key: r.model, label: shortName(r.model), data: r, status: 'done' }));
  }
  const outputs = live.outputs?.[stage] || {};
  const started = Object.keys(live.members).some((k) => k.startsWith(`${stage}:`));
  if (!started && !final) return [];
  return (live.council || []).map((model) => {
    const member = live.members[`${stage}:${model}`] || { status: 'pending' };
    const data = outputs[model] || final?.find((r) => r.model === model) || null;
    return { key: model, label: shortName(model), data, status: data ? 'done' : member.status };
  });
}

export default function RunView({ msg, pricing }) {
  const aggregate = useMemo(() => msg.metadata?.aggregate_rankings || [], [msg.metadata]);
  const labelToModel = msg.metadata?.label_to_model || msg.live?.labels;
  const order = useMemo(() => aggregate.map((a) => a.model), [aggregate]);
  const stage = msg.live?.stage;
  const [selected, setSelected] = useState({ stage1: null, stage2: null });
  const answersRef = useRef(null);
  const evaluationsRef = useRef(null);

  const answers = stageItems(msg, 'stage1');
  const evaluations = stageItems(msg, 'stage2');
  const answersReady = answers.filter((i) => i.data).length;
  const evaluationsReady = evaluations.filter((i) => i.data).length;

  const openMember = (stageId, model) => {
    setSelected((s) => ({ ...s, [stageId]: model }));
    const target = stageId === 'stage1' ? answersRef.current : evaluationsRef.current;
    target?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  return (
    <div className="run">
      <RunProgress msg={msg} onOpenMember={openMember} pricing={pricing} />

      {msg.stage3 && <FinalAnswer stage3={msg.stage3} pricing={pricing} />}
      {stage === 'stage3' && !msg.stage3 && (
        <Card tone="dark" className="placeholder"><Spinner /> O presidente está escrevendo a síntese…</Card>
      )}

      {aggregate.length > 0 && msg.stage2?.length > 0 && (
        <>
          <Card tone="dark" eyebrow="Street cred" title="Ranking agregado">
            <p className="card-note">Posição média dada pelos pares, de 1º (melhor) a {aggregate.length}º.</p>
            <RankDotPlot
              rows={aggregate.map((a) => ({ model: a.model, value: a.average_rank, count: a.rankings_count }))}
              total={aggregate.length}
            />
          </Card>
          <Card tone="dark" eyebrow="Quem votou em quem" title="Matriz de avaliação">
            <p className="card-note">Lugar que cada avaliador deu a cada resposta. As respostas eram anônimas.</p>
            <PeerMatrix rankings={msg.stage2} labelToModel={labelToModel} columnOrder={order} />
          </Card>
        </>
      )}

      {answers.length > 0 && (
        <Card
          tone="dark"
          eyebrow="Etapa 1"
          title="Respostas individuais"
          ref={answersRef}
          className="scroll-target"
          actions={answersReady < answers.length && <Badge variant="muted">{answersReady}/{answers.length} prontas</Badge>}
        >
          <MemberTabs
            label="Respostas por modelo"
            items={answers}
            activeKey={selected.stage1}
            onSelect={(key) => setSelected((s) => ({ ...s, stage1: key }))}
            pendingText="Nenhum membro terminou ainda. As respostas aparecem aqui conforme ficam prontas."
            render={({ data }) => (
              <>
                <div className="answer-meta">
                  <code>{data.model}</code>
                  <UsageBadges data={data} pricing={pricing} />
                </div>
                <div className="markdown-content"><SafeMarkdown>{data.response}</SafeMarkdown></div>
              </>
            )}
          />
        </Card>
      )}
      {stage === 'starting' && (
        <Card tone="dark" className="placeholder"><Spinner /> Convocando o conselho…</Card>
      )}

      {evaluations.length > 0 && (
        <Card
          tone="dark"
          eyebrow="Etapa 2"
          title="Avaliações completas"
          ref={evaluationsRef}
          className="scroll-target"
          actions={evaluationsReady < evaluations.length && <Badge variant="muted">{evaluationsReady}/{evaluations.length} prontas</Badge>}
        >
          <p className="card-note">
            Cada modelo avaliou as respostas como "Response A, B, C…". Os nomes em negrito foram trocados só para leitura.
          </p>
          <MemberTabs
            label="Avaliações por modelo"
            items={evaluations}
            activeKey={selected.stage2}
            onSelect={(key) => setSelected((s) => ({ ...s, stage2: key }))}
            pendingText="Nenhuma avaliação pronta ainda."
            render={({ data }) => (
              <>
                <div className="answer-meta">
                  <code>{data.model}</code>
                  <UsageBadges data={data} pricing={pricing} />
                </div>
                <div className="markdown-content"><SafeMarkdown>{deAnonymize(data.ranking, labelToModel)}</SafeMarkdown></div>
                {data.parsed_ranking?.length > 0 ? (
                  <div className="parsed">
                    <span className="parsed__title">Ranking extraído</span>
                    <ol>
                      {data.parsed_ranking.map((label, i) => (
                        <li key={`${label}-${i}`}>{labelToModel?.[label] ? shortName(labelToModel[label]) : label}</li>
                      ))}
                    </ol>
                  </div>
                ) : (
                  <p className="error-text parsed">Ranking não extraído: o modelo não seguiu o formato "FINAL RANKING:". O voto dele fica fora do agregado.</p>
                )}
              </>
            )}
          />
        </Card>
      )}
    </div>
  );
}
