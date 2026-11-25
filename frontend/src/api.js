/**
 * API client for the GCP LLM Council backend.
 */

const API_BASE = 'http://localhost:8001';

async function request(path, options = {}) {
  const response = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: options.body ? { 'Content-Type': 'application/json', ...options.headers } : options.headers,
  });
  if (!response.ok) {
    let detail = '';
    try {
      const body = await response.json();
      detail = typeof body.detail === 'string' ? body.detail : '';
    } catch {
      /* no JSON body */
    }
    throw new ApiError(response.status, errorMessage(response.status, detail));
  }
  return response.json();
}

export class ApiError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function errorMessage(status, detail) {
  if (status === 429) return detail.includes('model tests')
    ? 'Limite de testes por minuto atingido. Tente de novo em instantes.'
    : 'Limite de perguntas por minuto atingido. Tente de novo em instantes.';
  if (status === 422) return detail || 'Dados inválidos.';
  if (status === 404) return 'Não encontrado.';
  return detail || 'Falha ao falar com o backend.';
}

export const api = {
  listConversations: () => request('/api/conversations'),
  createConversation: () => request('/api/conversations', { method: 'POST', body: '{}' }),
  getConversation: (id) => request(`/api/conversations/${id}`),
  deleteConversation: (id) => request(`/api/conversations/${id}`, { method: 'DELETE' }),

  getConfig: () => request('/api/config'),
  saveConfig: (config) => request('/api/config', { method: 'PUT', body: JSON.stringify(config) }),
  resetConfig: () => request('/api/config', { method: 'DELETE' }),
  testModel: (model) => request('/api/models/test', { method: 'POST', body: JSON.stringify({ model }) }),

  getStats: () => request('/api/stats'),

  /**
   * Send a message and receive Server-Sent Events while the council runs.
   * @param {(type: string, event: object) => void} onEvent
   */
  async sendMessageStream(conversationId, content, onEvent) {
    const response = await fetch(`${API_BASE}/api/conversations/${conversationId}/message/stream`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content }),
    });

    if (!response.ok) {
      let detail = '';
      try {
        const body = await response.json();
        detail = typeof body.detail === 'string' ? body.detail : '';
      } catch {
        /* no JSON body */
      }
      throw new ApiError(response.status, errorMessage(response.status, detail));
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    // Events are separated by a blank line; a chunk may end mid-event.
    for (;;) {
      const { done, value } = await reader.read();
      buffer += decoder.decode(value || new Uint8Array(), { stream: !done });
      const parts = buffer.split('\n\n');
      buffer = parts.pop();
      for (const part of parts) {
        const line = part.split('\n').find((l) => l.startsWith('data: '));
        if (!line) continue;
        try {
          const event = JSON.parse(line.slice(6));
          onEvent(event.type, event);
        } catch (e) {
          console.error('Failed to parse SSE event:', e);
        }
      }
      if (done) break;
    }
  },
};
