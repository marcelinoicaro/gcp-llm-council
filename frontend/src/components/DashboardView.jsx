import { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, RefreshCw, Trophy } from 'lucide-react';
import { api } from '../api';
import { RankDotPlot } from './charts';
import { Badge, Button, Card, Spinner } from '../ui';
import { formatUsd } from '../lib/cost';
import { displayTitle, formatDate, formatMs, formatNumber, formatRank, percent, shortName } from '../lib/format';

function StatTile({ label, value, note }) {
  return (
    <div className="stat">
      <span className="stat__label">{label}</span>
      <span className="stat__value">{value}</span>
      {note && <span className="stat__note">{note}</span>}
    </div>
  );
}

export default function DashboardView({ onOpenConversation }) {
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setStats(await api.getStats());
    } catch {
      setError('Não foi possível carregar as métricas.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const t = stats?.totals;
  const ranked = (stats?.models || []).filter((m) => m.average_rank != null);
  const maxPlaces = Math.max(2, ...((stats?.recent_runs || []).map((r) => r.members)));

  return (
    <div className="view">
      <header className="view__head">
        <div>
          <div className="im-eyebrow">Acompanhamento</div>
          <h1 className="view__title">Painel do conselho</h1>
        </div>
        <Button variant="secondary" icon={loading ? <Spinner size={14} /> : <RefreshCw size={15} strokeWidth={2.5} />} onClick={load} disabled={loading}>
          Atualizar
        </Button>
      </header>

      {error && <div className="notice notice--error">{error}</div>}

      {stats && t.runs === 0 && (
        <Card tone="dark" title="Nada para mostrar ainda">
          <p className="card-note">
            As métricas aparecem depois da primeira pergunta respondida com esta versão do app. Conversas antigas não guardavam esses dados.
          </p>
        </Card>
      )}

      {stats && t.runs > 0 && (
        <>
          <div className="stats-row">
            <StatTile label="Perguntas respondidas" value={formatNumber(t.runs)} />
            <StatTile label="Duração mediana" value={formatMs(t.median_duration_ms)} note="da pergunta à síntese" />
            <StatTile label="Chamadas aos modelos" value={formatNumber(t.calls)} note={`${t.failures} falha${t.failures === 1 ? '' : 's'}`} />
            <StatTile
              label="Custo estimado"
              value={formatUsd(t.cost_usd)}
              note={`mediana ${formatUsd(t.median_cost_usd)} por pergunta${t.unpriced_calls ? ` · ${t.unpriced_calls} chamadas sem preço` : ''}`}
            />
            <StatTile
              label="Tokens"
              value={formatNumber(t.input_tokens + t.output_tokens + t.reasoning_tokens)}
              note={`${formatNumber(t.output_tokens)} saída · ${formatNumber(t.reasoning_tokens)} raciocínio`}
            />
          </div>

          <div className="grid-2">
            <Card tone="dark" eyebrow="Média entre perguntas" title="Posição média por modelo">
              <p className="card-note">
                Média das posições agregadas de cada pergunta. Conselhos de tamanhos diferentes entram na mesma média; compare com cuidado.
              </p>
              <RankDotPlot rows={ranked.map((m) => ({ model: m.model, value: m.average_rank, count: m.runs }))} total={maxPlaces} />
            </Card>

            <Card tone="dark" eyebrow="Histórico" title="Últimas perguntas">
              <ul className="recent">
                {stats.recent_runs.map((r) => (
                  <li key={`${r.conversation_id}-${r.created_at}`}>
                    <button type="button" className="recent__item" onClick={() => onOpenConversation(r.conversation_id)}>
                      <span className="recent__title">{displayTitle(r.title)}</span>
                      <span className="recent__meta">
                        {formatDate(r.created_at)} · {r.members} membros · {formatMs(r.duration_ms)} · {formatUsd(r.cost_usd)}
                        {r.failures > 0 && ` · ${r.failures} falha${r.failures > 1 ? 's' : ''}`}
                      </span>
                      {r.winner && (
                        <span className="recent__winner"><Trophy size={13} strokeWidth={2.5} /> {shortName(r.winner)}</span>
                      )}
                    </button>
                  </li>
                ))}
              </ul>
            </Card>
          </div>

          <Card tone="dark" eyebrow="Por modelo" title="Desempenho dos membros">
            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th scope="col">Modelo</th>
                    <th scope="col" className="num">Perguntas</th>
                    <th scope="col" className="num">Vitórias</th>
                    <th scope="col" className="num">Posição média</th>
                    <th scope="col" className="num">Latência mediana · resposta</th>
                    <th scope="col" className="num">· avaliação</th>
                    <th scope="col" className="num">Falhas</th>
                    <th scope="col" className="num">Tokens de saída</th>
                    <th scope="col" className="num">Custo estimado</th>
                  </tr>
                </thead>
                <tbody>
                  {stats.models.map((m) => (
                    <tr key={m.model}>
                      <th scope="row" title={m.model}>
                        <span className="table-model">
                          {shortName(m.model)}
                          {m.chairman_runs > 0 && <Badge variant="black">presidente ×{m.chairman_runs}</Badge>}
                        </span>
                      </th>
                      <td className="num">{m.runs}</td>
                      <td className="num">{m.wins}</td>
                      <td className="num">{formatRank(m.average_rank)}</td>
                      <td className="num">{formatMs(m.latency_ms.stage1)}</td>
                      <td className="num">{formatMs(m.latency_ms.stage2)}</td>
                      <td className="num">
                        {m.failures > 0 ? (
                          <span className="fail-cell"><AlertTriangle size={13} strokeWidth={2.5} aria-hidden="true" /> {m.failures} ({percent(m.failure_rate)})</span>
                        ) : '0'}
                      </td>
                      <td className="num">{formatNumber(m.output_tokens + m.reasoning_tokens)}</td>
                      <td className="num">{m.unpriced_calls && !m.cost_usd ? 'sem preço' : formatUsd(m.cost_usd)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
          <p className="cost-note">
            Custos estimados a partir dos tokens (entrada, saída e raciocínio) e dos preços do Vertex AI no endpoint global.
            Perguntas feitas antes do registro de tokens de raciocínio do Gemini aparecem subestimadas.
          </p>
        </>
      )}
    </div>
  );
}
