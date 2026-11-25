/** Display helpers shared by the views. */

export function shortName(model) {
  if (!model) return '';
  const name = model.split('@')[0];
  return name.split('/')[1] || name;
}

/** The backend's default title is English; show it in Portuguese. */
export function displayTitle(title) {
  return !title || title === 'New Conversation' ? 'Nova conversa' : title;
}

export function publisher(model) {
  return (model || '').split('/')[0];
}

const FAMILY = {
  google: 'Gemini',
  anthropic: 'Claude',
  openai: 'OpenAI',
};

export function family(model) {
  return FAMILY[publisher(model)] || 'Open models';
}

export function formatMs(ms) {
  if (ms == null) return '—';
  if (ms < 1000) return `${ms} ms`;
  const s = ms / 1000;
  if (s < 60) return `${s.toFixed(s < 10 ? 1 : 0).replace('.', ',')} s`;
  const m = Math.floor(s / 60);
  const rest = Math.round(s % 60);
  return `${m} min ${rest.toString().padStart(2, '0')} s`;
}

export function formatNumber(n) {
  if (n == null) return '—';
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1).replace('.', ',')} mi`;
  if (n >= 10_000) return `${Math.round(n / 1000)} mil`;
  if (n >= 1000) return `${(n / 1000).toFixed(1).replace('.', ',')} mil`;
  return String(n);
}

export function formatRank(n) {
  return n == null ? '—' : n.toFixed(2).replace('.', ',');
}

export function formatDate(iso) {
  if (!iso) return '';
  const d = new Date(iso.endsWith('Z') ? iso : `${iso}Z`);
  return d.toLocaleString('pt-BR', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
}

export function percent(x) {
  return x == null ? '—' : `${Math.round(x * 100)}%`;
}

/**
 * Sequential neon ramp for rank cells on a dark surface (dark mode: the
 * bright end means "more"): position 1 is full neon, the last position sits
 * near the card surface. Lightness rises monotonically with quality.
 */
export function rankColor(position, total) {
  const t = total > 1 ? 1 - (position - 1) / (total - 1) : 1;
  const mix = 0.12 + 0.88 * t;
  const from = [0x28, 0x28, 0x29];
  const to = [0x7c, 0xff, 0x01];
  const rgb = from.map((c, i) => Math.round(c + (to[i] - c) * mix));
  return {
    background: `rgb(${rgb.join(',')})`,
    // Switch ink where both black and white stay near 4.5:1 on the fill.
    color: mix > 0.45 ? 'var(--im-black)' : 'var(--im-white)',
  };
}
