/**
 * Small chart components in plain HTML/CSS (no chart library).
 * - Single-series charts use one hue (neon) and no legend; the title names them.
 * - Values and labels use text tokens, never the series color.
 * - Every mark has a hover tooltip; rank cells also print their value.
 */
import { useState } from 'react';
import { formatMs, formatNumber, formatRank, rankColor, shortName } from '../lib/format';

function useTooltip() {
  const [tip, setTip] = useState(null);
  // Position relative to the chart root (the nearest [data-chart] element).
  const show = (e, content) => {
    const root = e.currentTarget.closest('[data-chart]');
    if (!root) return;
    const box = root.getBoundingClientRect();
    const x = e.clientX ?? box.left;
    const y = e.clientY ?? box.top;
    setTip({ x: x - box.left, y: y - box.top, content });
  };
  const hide = () => setTip(null);
  const node = tip && (
    <div className="chart-tooltip" style={{ left: tip.x, top: tip.y }} role="tooltip">
      {tip.content}
    </div>
  );
  return { show, hide, node };
}

/** Average rank per model on a 1..N axis (1 = best). A dot plot: no misleading bar baseline. */
export function RankDotPlot({ rows, total }) {
  const tt = useTooltip();
  const max = Math.max(total || 1, 2);
  const pos = (v) => ((v - 1) / (max - 1)) * 100;
  const ticks = Array.from({ length: max }, (_, i) => i + 1);

  return (
    <div className="dotplot" data-chart onMouseLeave={tt.hide}>
      <div className="dotplot__axis-labels" aria-hidden="true">
        <span>1º · melhor</span>
        <span>{max}º</span>
      </div>
      {rows.map((r, i) => (
        <div className="dotplot__row" key={r.model}>
          <div className="dotplot__label">
            <span className="dotplot__place">{i + 1}</span>
            <span className="dotplot__name" title={r.model}>{shortName(r.model)}</span>
          </div>
          <div className="dotplot__track">
            {ticks.map((t) => (
              <span key={t} className="dotplot__tick" style={{ left: `${pos(t)}%` }} />
            ))}
            <span className="dotplot__stem" style={{ width: `${pos(r.value)}%` }} />
            <button
              type="button"
              className={`dotplot__dot ${i === 0 ? 'is-top' : ''}`}
              style={{ left: `${pos(r.value)}%` }}
              aria-label={`${shortName(r.model)}: posição média ${formatRank(r.value)}`}
              onMouseMove={(e) => tt.show(e, (
                <>
                  <strong>{shortName(r.model)}</strong>
                  <span>Posição média {formatRank(r.value)}</span>
                  {r.count != null && <span>{r.count} votos</span>}
                </>
              ))}
              onFocus={(e) => {
                const b = e.currentTarget.getBoundingClientRect();
                tt.show({ currentTarget: e.currentTarget, clientX: b.x, clientY: b.y }, `${shortName(r.model)}: ${formatRank(r.value)}`);
              }}
              onBlur={tt.hide}
            />
          </div>
          <span className="dotplot__value">{formatRank(r.value)}</span>
        </div>
      ))}
      {tt.node}
    </div>
  );
}

/**
 * Peer-review matrix: one row per reviewer, one column per reviewed model,
 * cell = position the reviewer gave. The reviewer's own (anonymous) answer
 * is outlined: self-assessment is a known bias to watch.
 */
export function PeerMatrix({ rankings, labelToModel, columnOrder }) {
  const tt = useTooltip();
  const columns = columnOrder?.length ? columnOrder : Object.values(labelToModel || {});
  const modelToLabel = Object.fromEntries(Object.entries(labelToModel || {}).map(([l, m]) => [m, l]));
  const n = columns.length;

  return (
    <div className="matrix-wrap" data-chart onMouseLeave={tt.hide}>
      <table className="matrix">
        <thead>
          <tr>
            <th scope="col" className="matrix__corner">Avaliador ↓ · avaliado →</th>
            {columns.map((m) => (
              <th scope="col" key={m} className="matrix__col" title={m}>
                <span>{shortName(m)}</span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rankings.map((r) => {
            const positions = {};
            (r.parsed_ranking || []).forEach((label, idx) => {
              if (!(label in positions)) positions[label] = idx + 1;
            });
            const unparsed = !(r.parsed_ranking || []).length;
            return (
              <tr key={r.model}>
                <th scope="row" className="matrix__row" title={unparsed ? `${r.model}: ranking não extraído (formato fora do pedido)` : r.model}>
                  {shortName(r.model)}
                  {unparsed && <span className="matrix__flag"> · sem ranking</span>}
                </th>
                {columns.map((m) => {
                  const p = positions[modelToLabel[m]];
                  const self = m === r.model;
                  if (p == null) {
                    return <td key={m} className="matrix__cell is-empty">—</td>;
                  }
                  return (
                    <td
                      key={m}
                      className={`matrix__cell ${self ? 'is-self' : ''}`}
                      style={rankColor(p, n)}
                      onMouseMove={(e) => tt.show(e, (
                        <>
                          <strong>{shortName(r.model)} → {shortName(m)}</strong>
                          <span>{p}º lugar de {n}</span>
                          {self && <span>Avaliou a própria resposta (sem saber)</span>}
                        </>
                      ))}
                    >
                      {p}
                    </td>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
      </table>
      <div className="matrix__legend" aria-hidden="true">
        <span>1º</span>
        <span className="matrix__ramp" />
        <span>{n}º</span>
        <span className="matrix__self-key">contorno = autoavaliação</span>
      </div>
      {tt.node}
    </div>
  );
}

/** Horizontal latency bars for one stage (single series). Failures are labeled, not colored alone. */
export function LatencyBars({ rows }) {
  const tt = useTooltip();
  const max = Math.max(1, ...rows.filter((r) => r.ok).map((r) => r.latency_ms || 0));
  return (
    <div className="bars" data-chart onMouseLeave={tt.hide}>
      {rows.map((r) => (
        <div className="bars__row" key={r.model}>
          <span className="bars__label" title={r.model}>{shortName(r.model)}</span>
          <div className="bars__track">
            {r.ok ? (
              <span
                className="bars__bar"
                style={{ width: `${Math.max(2, (r.latency_ms / max) * 100)}%` }}
                onMouseMove={(e) => tt.show(e, (
                  <>
                    <strong>{shortName(r.model)}</strong>
                    <span>{formatMs(r.latency_ms)}</span>
                    {r.usage?.output_tokens != null && <span>{formatNumber(r.usage.output_tokens)} tokens de saída</span>}
                  </>
                ))}
              />
            ) : (
              <span className="bars__failed">falhou</span>
            )}
          </div>
          <span className="bars__value">{r.ok ? formatMs(r.latency_ms) : '—'}</span>
        </div>
      ))}
      {tt.node}
    </div>
  );
}
