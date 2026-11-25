import { useCallback, useEffect, useState } from 'react';
import Sidebar from './components/Sidebar';
import ChatView from './components/ChatView';
import SettingsView from './components/SettingsView';
import DashboardView from './components/DashboardView';
import { api } from './api';
import './App.css';

const memberKey = (stage, model) => `${stage}:${model}`;

function App() {
  const [view, setView] = useState('chat');
  const [conversations, setConversations] = useState([]);
  const [currentId, setCurrentId] = useState(null);
  const [conversation, setConversation] = useState(null);
  const [config, setConfig] = useState(null);
  const [isRunning, setIsRunning] = useState(false);
  const [error, setError] = useState(null);

  const loadConversations = useCallback(async () => {
    try {
      setConversations(await api.listConversations());
    } catch {
      setError('Não foi possível carregar as conversas. O backend está rodando?');
    }
  }, []);

  const loadConfig = useCallback(async () => {
    try {
      setConfig(await api.getConfig());
    } catch {
      /* the settings view shows its own error */
    }
  }, []);

  useEffect(() => {
    loadConversations();
    loadConfig();
  }, [loadConversations, loadConfig]);

  useEffect(() => {
    if (!currentId) {
      setConversation(null);
      return;
    }
    // A conversation created for a question being sent is filled locally.
    if (conversation?.id === currentId) return;
    api.getConversation(currentId)
      .then(setConversation)
      .catch(() => setError('Não foi possível abrir a conversa.'));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentId]);

  const openConversation = (id) => {
    setCurrentId(id);
    setView('chat');
  };

  const createConversation = async () => {
    const created = await api.createConversation();
    setConversations((prev) => [
      { id: created.id, created_at: created.created_at, title: created.title, message_count: 0 },
      ...prev,
    ]);
    return created;
  };

  const newConversation = () => {
    setCurrentId(null);
    setView('chat');
  };

  const deleteConversation = async (id) => {
    try {
      await api.deleteConversation(id);
      setConversations((prev) => prev.filter((c) => c.id !== id));
      if (id === currentId) setCurrentId(null);
    } catch {
      setError('Não foi possível excluir a conversa.');
    }
  };

  // Immutable update of the assistant message being streamed (always the last one).
  const updateRun = (fn) => {
    setConversation((prev) => {
      if (!prev) return prev;
      const messages = [...prev.messages];
      const last = messages[messages.length - 1];
      messages[messages.length - 1] = fn({ ...last, live: { ...last.live, members: { ...last.live.members } } });
      return { ...prev, messages };
    });
  };

  const handleEvent = (type, event) => {
    switch (type) {
      case 'run_start':
        updateRun((m) => ({ ...m, live: { ...m.live, council: event.council, chairman: event.chairman } }));
        break;
      case 'stage1_start':
      case 'stage2_start':
      case 'stage3_start': {
        const stage = type.slice(0, 6);
        updateRun((m) => ({
          ...m,
          live: { ...m.live, stage, stageStarted: { ...m.live.stageStarted, [stage]: Date.now() } },
        }));
        break;
      }
      case 'member_start':
        updateRun((m) => {
          m.live.members[memberKey(event.stage, event.model)] = { status: 'running', startedAt: Date.now() };
          return m;
        });
        break;
      case 'member_done':
        updateRun((m) => {
          m.live.members[memberKey(event.stage, event.model)] = {
            status: event.ok ? 'done' : 'failed',
            latency_ms: event.latency_ms,
            usage: event.usage,
            cost_usd: event.cost_usd,
          };
          // Keep each member's output as soon as it arrives (partial results).
          if (event.ok && (event.stage === 'stage1' || event.stage === 'stage2')) {
            const item = event.stage === 'stage1'
              ? {
                model: event.model,
                response: event.content,
                latency_ms: event.latency_ms,
                usage: event.usage,
                cost_usd: event.cost_usd,
              }
              : {
                model: event.model,
                ranking: event.content,
                parsed_ranking: event.parsed_ranking,
                latency_ms: event.latency_ms,
                usage: event.usage,
                cost_usd: event.cost_usd,
              };
            const outputs = m.live.outputs || {};
            m.live.outputs = { ...outputs, [event.stage]: { ...(outputs[event.stage] || {}), [event.model]: item } };
          }
          return m;
        });
        break;
      case 'stage2_labels':
        updateRun((m) => ({ ...m, live: { ...m.live, labels: event.label_to_model } }));
        break;
      case 'stage1_complete':
        updateRun((m) => ({ ...m, stage1: event.data }));
        break;
      case 'stage2_complete':
        updateRun((m) => ({ ...m, stage2: event.data, metadata: { ...m.metadata, ...event.metadata } }));
        break;
      case 'stage3_complete':
        updateRun((m) => ({ ...m, stage3: event.data }));
        break;
      case 'title_complete':
        setConversation((prev) => (prev ? { ...prev, title: event.data.title } : prev));
        loadConversations();
        break;
      case 'complete':
        updateRun((m) => ({ ...m, metadata: event.metadata, live: { ...m.live, stage: 'done' } }));
        loadConversations();
        setIsRunning(false);
        break;
      case 'error':
        updateRun((m) => ({ ...m, live: { ...m.live, stage: 'error' } }));
        setError(event.message || 'O conselho falhou.');
        setIsRunning(false);
        break;
      default:
        break;
    }
  };

  const sendMessage = async (content) => {
    setError(null);
    let target = conversation;
    try {
      if (!target) {
        const created = await createConversation();
        target = { ...created, messages: [] };
      }
    } catch {
      setError('Não foi possível criar a conversa.');
      return;
    }

    setIsRunning(true);
    setCurrentId(target.id);
    setConversation({
      ...target,
      messages: [
        ...target.messages,
        { role: 'user', content },
        {
          role: 'assistant',
          stage1: null,
          stage2: null,
          stage3: null,
          metadata: null,
          live: { stage: 'starting', members: {}, stageStarted: {}, startedAt: Date.now() },
        },
      ],
    });

    try {
      await api.sendMessageStream(target.id, content, handleEvent);
    } catch (e) {
      setError(e.message);
      setConversation((prev) => (prev ? { ...prev, messages: prev.messages.slice(0, -2) } : prev));
      setIsRunning(false);
    }
  };

  return (
    <div className="app">
      <Sidebar
        view={view}
        onNavigate={setView}
        conversations={conversations}
        currentId={currentId}
        onSelect={openConversation}
        onNew={newConversation}
        onDelete={deleteConversation}
        disabled={isRunning}
      />
      <main className="main">
        {error && (
          <div className="toast" role="alert">
            <span>{error}</span>
            <button type="button" className="toast__close" onClick={() => setError(null)} aria-label="Fechar aviso">
              ×
            </button>
          </div>
        )}
        {view === 'chat' && (
          <ChatView
            conversation={conversation}
            config={config}
            isRunning={isRunning}
            onSend={sendMessage}
            onNew={newConversation}
            onOpenSettings={() => setView('settings')}
          />
        )}
        {view === 'settings' && <SettingsView config={config} onSaved={setConfig} disabled={isRunning} />}
        {view === 'dashboard' && <DashboardView onOpenConversation={openConversation} />}
      </main>
    </div>
  );
}

export default App;
