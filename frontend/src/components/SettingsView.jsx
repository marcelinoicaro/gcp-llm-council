import { useEffect, useMemo, useState } from 'react';
import { Activity, Plus, RotateCcw, Save } from 'lucide-react';
import { api } from '../api';
import { Badge, Button, Card, Checkbox, Spinner } from '../ui';
import { family, formatMs, shortName } from '../lib/format';
import { formatPrice } from '../lib/cost';

const FAMILY_ORDER = ['Gemini', 'Claude', 'OpenAI', 'Open models'];
const MODEL_ID_RE = /^[a-z0-9][a-z0-9-]{0,40}\/[A-Za-z0-9][A-Za-z0-9._-]{0,80}(@[a-z0-9-]{2,30})?$/;

function TestResult({ result }) {
  if (!result) return null;
  if (result.state === 'testing') return <Badge variant="muted"><Spinner size={10} /> testando</Badge>;
  if (result.state === 'ok') return <Badge variant="neon">ok · {formatMs(result.latency_ms)}</Badge>;
  return <Badge variant="danger">{result.message || 'sem resposta'}</Badge>;
}

export default function SettingsView({ config, onSaved, disabled }) {
  const [members, setMembers] = useState([]);
  const [chairman, setChairman] = useState('');
  const [titleModel, setTitleModel] = useState('');
  const [custom, setCustom] = useState('');
  const [extra, setExtra] = useState([]);
  const [tests, setTests] = useState({});
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState(null);

  useEffect(() => {
    if (!config) return;
    setMembers(config.council_models);
    setChairman(config.chairman_model);
    setTitleModel(config.title_model);
    const known = new Set(config.catalog.map((c) => c.id));
    setExtra([...new Set([config.chairman_model, config.title_model, ...config.council_models])].filter((m) => !known.has(m)));
  }, [config]);

  const allModels = useMemo(() => {
    if (!config) return [];
    return [...config.catalog.map((c) => ({ id: c.id, family: c.family })), ...extra.map((id) => ({ id, family: family(id), custom: true }))];
  }, [config, extra]);

  const grouped = useMemo(() => {
    const g = {};
    for (const m of allModels) (g[m.family] ||= []).push(m);
    return FAMILY_ORDER.filter((f) => g[f]).map((f) => [f, g[f]]);
  }, [allModels]);

  if (!config) {
    return (
      <div className="view">
        <p className="card-note">Carregando a configuração… Se não carregar, confira se o backend está rodando.</p>
      </div>
    );
  }

  const { limits } = config;
  const dirty =
    chairman !== config.chairman_model ||
    titleModel !== config.title_model ||
    members.join('|') !== config.council_models.join('|');
  const countOk = members.length >= limits.min_members && members.length <= limits.max_members;

  const toggle = (id, on) => {
    setMembers((prev) => (on ? [...prev, id] : prev.filter((m) => m !== id)));
  };

  const runTest = async (id) => {
    setTests((t) => ({ ...t, [id]: { state: 'testing' } }));
    try {
      const r = await api.testModel(id);
      setTests((t) => ({ ...t, [id]: { state: r.ok ? 'ok' : 'fail', latency_ms: r.latency_ms } }));
    } catch (e) {
      setTests((t) => ({ ...t, [id]: { state: 'fail', message: e.status === 429 ? 'limite/min' : 'erro' } }));
    }
  };

  const testSelected = async () => {
    await Promise.all(members.map(runTest));
  };

  const addCustom = (e) => {
    e.preventDefault();
    const id = custom.trim();
    if (!MODEL_ID_RE.test(id)) {
      setNotice({ kind: 'error', text: 'Use o formato publisher/modelo, com @região opcional. Ex.: qwen/qwen3-max-maas@global' });
      return;
    }
    if (!allModels.some((m) => m.id === id)) setExtra((x) => [...x, id]);
    if (!members.includes(id)) setMembers((m) => [...m, id]);
    setCustom('');
    setNotice(null);
  };

  const save = async () => {
    setSaving(true);
    setNotice(null);
    try {
      const updated = await api.saveConfig({ council_models: members, chairman_model: chairman, title_model: titleModel });
      onSaved(updated);
      setNotice({ kind: 'ok', text: 'Configuração salva. Vale a partir da próxima pergunta.' });
    } catch (e) {
      setNotice({ kind: 'error', text: e.message });
    } finally {
      setSaving(false);
    }
  };

  const reset = async () => {
    setSaving(true);
    try {
      const updated = await api.resetConfig();
      onSaved(updated);
      setNotice({ kind: 'ok', text: 'Voltou para o padrão do .env / config.py.' });
    } catch (e) {
      setNotice({ kind: 'error', text: e.message });
    } finally {
      setSaving(false);
    }
  };

  const modelOptions = allModels.map((m) => m.id);

  return (
    <div className="view">
      <header className="view__head">
        <div>
          <div className="im-eyebrow">Configuração</div>
          <h1 className="view__title">Monte o seu conselho</h1>
        </div>
        <div className="view__actions">
          <Button variant="ghost" icon={<RotateCcw size={15} strokeWidth={2.5} />} onClick={reset} disabled={saving || disabled}>
            Padrão
          </Button>
          <Button
            variant="primary"
            icon={<Save size={15} strokeWidth={2.5} />}
            onClick={save}
            disabled={!dirty || !countOk || saving || disabled}
          >
            {saving ? 'Salvando…' : 'Salvar'}
          </Button>
        </div>
      </header>

      {disabled && <div className="notice">Há uma pergunta em andamento. Salve depois que ela terminar.</div>}
      {notice && <div className={`notice notice--${notice.kind}`} role="status">{notice.text}</div>}

      <div className="settings-grid">
        <Card
          tone="dark"
          eyebrow="Membros"
          title={`${members.length} selecionados`}
          actions={(
            <Button variant="secondary" size="sm" icon={<Activity size={14} strokeWidth={2.5} />} onClick={testSelected} disabled={!members.length}>
              Testar selecionados
            </Button>
          )}
        >
          <p className="card-note">
            Entre {limits.min_members} e {limits.max_members} membros. Cada pergunta faz cerca de {members.length * 2 + 2} chamadas.
            Modelos de parceiros precisam estar habilitados no Model Garden e ter quota no projeto.
          </p>
          {!countOk && (
            <p className="error-text">Selecione entre {limits.min_members} e {limits.max_members} membros.</p>
          )}

          {grouped.map(([fam, models]) => (
            <div key={fam} className="model-group">
              <div className="model-group__title">{fam}</div>
              <ul className="model-list">
                {models.map((m) => (
                  <li key={m.id} className={`model-row ${members.includes(m.id) ? 'is-on' : ''}`}>
                    <Checkbox
                      checked={members.includes(m.id)}
                      onChange={(on) => toggle(m.id, on)}
                      label={(
                        <span className="model-row__name">
                          <strong>{shortName(m.id)}</strong>
                          <code>{m.id}</code>
                          <span className="model-row__price">{formatPrice(config.pricing?.per_million?.[m.id.split('@')[0]])}</span>
                        </span>
                      )}
                    />
                    <div className="model-row__side">
                      {m.id === chairman && <Badge variant="black">presidente</Badge>}
                      {m.custom && <Badge variant="outline">manual</Badge>}
                      <TestResult result={tests[m.id]} />
                      <Button variant="ghost" size="sm" onClick={() => runTest(m.id)} disabled={tests[m.id]?.state === 'testing'}>
                        Testar
                      </Button>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          ))}

          <form className="add-model" onSubmit={addCustom}>
            <label htmlFor="custom-model" className="field-label">Adicionar modelo do Model Garden</label>
            <div className="add-model__row">
              <input
                id="custom-model"
                className="input"
                placeholder="publisher/modelo[@região]"
                value={custom}
                onChange={(e) => setCustom(e.target.value)}
              />
              <Button type="submit" variant="secondary" icon={<Plus size={15} strokeWidth={3} />} disabled={!custom.trim()}>
                Adicionar
              </Button>
            </div>
          </form>
        </Card>

        <div className="settings-side">
          <Card tone="dark" eyebrow="Papéis" title="Presidente e título">
            <label className="field">
              <span className="field-label">Presidente (síntese final)</span>
              <select className="input" value={chairman} onChange={(e) => setChairman(e.target.value)}>
                {modelOptions.map((id) => <option key={id} value={id}>{shortName(id)}</option>)}
              </select>
              <span className="field-help">Pode ou não ser membro do conselho.</span>
            </label>
            <label className="field">
              <span className="field-label">Modelo de título</span>
              <select className="input" value={titleModel} onChange={(e) => setTitleModel(e.target.value)}>
                {modelOptions.map((id) => <option key={id} value={id}>{shortName(id)}</option>)}
              </select>
              <span className="field-help">Um modelo rápido e barato basta.</span>
            </label>
          </Card>

          <Card tone="dark" eyebrow="Ambiente" title="Vertex AI">
            <dl className="facts">
              <dt>Projeto</dt><dd><code>{config.vertex.project_id || 'não definido'}</code></dd>
              <dt>Região padrão</dt><dd><code>{config.vertex.location}</code></dd>
              <dt>Identidade</dt><dd><code className="facts__wrap">{config.vertex.identity}</code></dd>
              <dt>Timeout por chamada</dt><dd>{limits.model_timeout_seconds} s</dd>
              <dt>Perguntas por minuto</dt><dd>{limits.max_messages_per_minute}</dd>
              <dt>Tamanho máximo</dt><dd>{limits.max_message_chars.toLocaleString('pt-BR')} caracteres</dd>
            </dl>
            <p className="card-note">Esses valores vêm do <code>.env</code> do backend.</p>
          </Card>
        </div>
      </div>
    </div>
  );
}
