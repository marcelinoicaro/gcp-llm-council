/**
 * Cost estimates. The price table comes from the backend (/api/config →
 * pricing), so there is a single source. Reasoning tokens are billed as output.
 */

export function estimateCost(model, usage, pricing) {
  const price = pricing?.per_million?.[(model || '').split('@')[0]];
  if (!price || !usage) return null;
  const input = usage.input_tokens || 0;
  const output = (usage.output_tokens || 0) + (usage.reasoning_tokens || 0);
  return (input * price.input + output * price.output) / 1_000_000;
}

/** Prefer the cost computed by the backend; fall back to the local table (older runs). */
export function costOf(item, pricing) {
  if (!item) return null;
  if (item.cost_usd != null) return item.cost_usd;
  return estimateCost(item.model, item.usage, pricing);
}

export function formatUsd(value) {
  if (value == null) return '—';
  if (value === 0) return 'US$ 0';
  const digits = value < 0.01 ? 4 : value < 1 ? 3 : 2;
  return `US$ ${value.toLocaleString('pt-BR', { minimumFractionDigits: digits, maximumFractionDigits: digits })}`;
}

export function formatPrice(price) {
  if (!price) return 'sem preço';
  const f = (n) => n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return `US$ ${f(price.input)} / ${f(price.output)} por 1M`;
}

/** Sum a list of costs; `complete` is false if any priced-able item had no estimate. */
export function sumCosts(costs) {
  let total = 0;
  let complete = true;
  for (const c of costs) {
    if (c == null) complete = false;
    else total += c;
  }
  return { total, complete };
}
