import { useMemo, useState } from 'react';
import {
  Bot,
  Check,
  Code2,
  Copy,
  Eraser,
  FileText,
  Loader2,
  Play,
  Send,
  Sparkles,
  Terminal,
} from 'lucide-react';
import './App.css';

const GEMINI_API_KEY = import.meta.env.VITE_GEMINI_API_KEY;
const GEMINI_MODELS = ['gemini-2.5-flash', 'gemini-2.0-flash', 'gemini-1.5-flash'];
const RETRYABLE_STATUS_CODES = new Set([408, 429, 500, 502, 503, 504]);

const starterCode = `<!doctype html>
<html lang="ru">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Era Bot Sandbox</title>
    <style>
      * { box-sizing: border-box; }
      body {
        margin: 0;
        min-height: 100vh;
        display: grid;
        place-items: center;
        font-family: Inter, system-ui, sans-serif;
        color: #f8fafc;
        background:
          radial-gradient(circle at 25% 20%, rgba(45, 212, 191, 0.28), transparent 28rem),
          radial-gradient(circle at 80% 70%, rgba(251, 191, 36, 0.22), transparent 22rem),
          #111827;
      }
      main {
        width: min(92vw, 720px);
        padding: 36px;
        border: 1px solid rgba(255, 255, 255, 0.14);
        border-radius: 18px;
        background: rgba(15, 23, 42, 0.82);
        box-shadow: 0 24px 70px rgba(0, 0, 0, 0.35);
      }
      h1 {
        margin: 0 0 12px;
        font-size: clamp(32px, 8vw, 64px);
        line-height: 0.95;
      }
      p {
        margin: 0 0 24px;
        color: #cbd5e1;
        font-size: 18px;
      }
      button {
        border: 0;
        border-radius: 12px;
        padding: 12px 18px;
        color: #082f49;
        background: #67e8f9;
        font-weight: 800;
        cursor: pointer;
      }
    </style>
  </head>
  <body>
    <main>
      <h1>Песочница готова</h1>
      <p>Попроси Era Bot создать сайт, игру или виджет, а потом запускай результат здесь.</p>
      <button onclick="document.body.style.background = '#14532d'">Проверить интерактив</button>
    </main>
  </body>
</html>`;

const welcomeMessage = {
  role: 'assistant',
  content:
    'Привет! Я Era Bot. Опиши, какой сайт, игру или компонент нужно сделать, а я подготовлю код и помогу запустить его в песочнице.',
};

function extractCodeBlock(text) {
  const match = text.match(/```(?:html|xml|svg)?\s*([\s\S]*?)```/i);
  return match?.[1]?.trim() ?? null;
}

function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function readGeminiError(response) {
  try {
    const data = await response.json();
    return data.error?.message ?? response.statusText;
  } catch {
    return response.statusText;
  }
}

function normalizeError(error) {
  if (!navigator.onLine) {
    return 'Нет подключения к интернету. Проверь сеть и попробуй еще раз.';
  }

  return error instanceof Error ? error.message : 'Неизвестная ошибка';
}

export default function App() {
  const [messages, setMessages] = useState([welcomeMessage]);
  const [input, setInput] = useState('');
  const [code, setCode] = useState(starterCode);
  const [activeTab, setActiveTab] = useState('preview');
  const [logs, setLogs] = useState(['Песочница инициализирована.', 'HTML-превью готово к запуску.']);
  const [isLoading, setIsLoading] = useState(false);
  const [copied, setCopied] = useState(false);

  const canUseAi = Boolean(GEMINI_API_KEY);

  const lineNumbers = useMemo(() => {
    return Array.from({ length: Math.max(code.split('\n').length, 1) }, (_, index) => index + 1);
  }, [code]);

  const askGemini = async (prompt, chatHistory) => {
    if (!canUseAi) {
      throw new Error('Добавь ключ Gemini в файл .env: VITE_GEMINI_API_KEY=твой_ключ');
    }

    const systemPrompt = `Ты Era Bot, живой русскоязычный AI-собеседник и помощник по коду.

Главное правило:
- Если пользователь просто здоровается, спрашивает "что делаешь", "как дела", пишет короткую фразу или хочет поговорить, отвечай как нормальный собеседник: тепло, понятно, по-русски, без генерации HTML.
- Если пользователь просит создать сайт, игру, страницу, виджет, лендинг или изменить текущий код, тогда верни готовый полный HTML в markdown-блоке \`\`\`html.
- Если фраза непонятная или с ошибками, мягко уточни, что пользователь хотел сказать. Не притворяйся, что понял.
- Не повторяй один и тот же шаблонный ответ. Учитывай историю переписки.

Текущий код песочницы:
\`\`\`html
${code}
\`\`\``;

    const historyText = chatHistory
      .slice(-10)
      .map((message) => `${message.role === 'user' ? 'Пользователь' : 'Era Bot'}: ${message.content}`)
      .join('\n');

    const payload = {
      contents: [
        {
          parts: [
            {
              text: `История переписки:
${historyText || 'Пока пусто.'}

Новое сообщение пользователя:
${prompt}`,
            },
          ],
        },
      ],
      systemInstruction: { parts: [{ text: systemPrompt }] },
      generationConfig: { temperature: 0.75 },
    };

    let lastError = 'Gemini временно недоступен.';

    for (const model of GEMINI_MODELS) {
      for (let attempt = 1; attempt <= 3; attempt += 1) {
        const response = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${GEMINI_API_KEY}`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
          },
        );

        if (response.ok) {
          const data = await response.json();
          return (
            data.candidates?.[0]?.content?.parts?.[0]?.text ??
            'Ответ пустой. Попробуй уточнить запрос.'
          );
        }

        const errorDetails = await readGeminiError(response);
        lastError = `Gemini вернул ошибку ${response.status}: ${errorDetails}`;

        if (!RETRYABLE_STATUS_CODES.has(response.status)) {
          break;
        }

        await sleep(900 * attempt);
      }
    }

    throw new Error(`${lastError} Я уже попробовал несколько раз, отправь запрос еще раз через минуту.`);
  };

  const sendMessage = async (text = input) => {
    const trimmed = text.trim();
    if (!trimmed || isLoading) return;

    const nextMessages = [...messages, { role: 'user', content: trimmed }];

    setInput('');
    setIsLoading(true);
    setMessages(nextMessages);

    try {
      const answer = await askGemini(trimmed, nextMessages);
      const nextCode = extractCodeBlock(answer);

      if (nextCode) {
        setCode(nextCode);
        setActiveTab('preview');
        setLogs((current) => [...current, 'AI сгенерировал HTML и открыл превью.']);
      }

      setMessages((current) => [...current, { role: 'assistant', content: answer }]);
    } catch (error) {
      const message = normalizeError(error);
      setMessages((current) => [
        ...current,
        { role: 'assistant', content: `Не смог получить ответ от AI. ${message}` },
      ]);
      setLogs((current) => [...current, `Ошибка: ${message}`]);
    } finally {
      setIsLoading(false);
    }
  };

  const runPreview = () => {
    setActiveTab('preview');
    setLogs((current) => [...current, 'Превью обновлено вручную.']);
  };

  const copyCode = async () => {
    await navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 1400);
  };

  const clearChat = () => {
    setMessages([welcomeMessage]);
    setLogs(['Чат очищен.', 'Код в песочнице оставлен без изменений.']);
  };

  return (
    <main className="app-shell">
      <section className="sidebar" aria-label="Чат с Era Bot">
        <header className="brand">
          <div className="brand-mark">
            <Bot size={24} />
          </div>
          <div>
            <h1>Era Bot</h1>
            <p>AI-помощник для сайтов, игр и быстрых прототипов</p>
          </div>
        </header>

        <div className="status-card">
          <Sparkles size={18} />
          <span>{canUseAi ? 'Gemini подключен через .env' : 'Нужен VITE_GEMINI_API_KEY в .env'}</span>
        </div>

        <div className="chat-list">
          {messages.map((message, index) => (
            <article className={`message ${message.role}`} key={`${message.role}-${index}`}>
              <span>{message.role === 'user' ? 'Ты' : 'Era Bot'}</span>
              <p>{message.content}</p>
            </article>
          ))}

          {isLoading && (
            <article className="message assistant">
              <span>Era Bot</span>
              <p className="loading-line">
                <Loader2 size={16} />
                Думаю над кодом...
              </p>
            </article>
          )}
        </div>

        <form
          className="composer"
          onSubmit={(event) => {
            event.preventDefault();
            sendMessage();
          }}
        >
          <input
            value={input}
            onChange={(event) => setInput(event.target.value)}
            placeholder="Например: сделай лендинг для кофейни"
            aria-label="Сообщение для Era Bot"
          />
          <button type="submit" disabled={!input.trim() || isLoading} title="Отправить">
            <Send size={18} />
          </button>
        </form>

        <div className="quick-actions">
          <button type="button" onClick={() => sendMessage('Улучши дизайн текущей страницы')}>
            Улучшить дизайн
          </button>
          <button type="button" onClick={() => sendMessage('Найди ошибки в текущем HTML')}>
            Найти ошибки
          </button>
          <button type="button" onClick={clearChat}>
            <Eraser size={15} />
            Очистить
          </button>
        </div>
      </section>

      <section className="workspace" aria-label="Песочница кода">
        <div className="workspace-toolbar">
          <div className="tabs" role="tablist" aria-label="Режим просмотра">
            <button
              type="button"
              className={activeTab === 'preview' ? 'active' : ''}
              onClick={() => setActiveTab('preview')}
            >
              <Play size={16} />
              Превью
            </button>
            <button
              type="button"
              className={activeTab === 'editor' ? 'active' : ''}
              onClick={() => setActiveTab('editor')}
            >
              <Code2 size={16} />
              Код
            </button>
            <button
              type="button"
              className={activeTab === 'logs' ? 'active' : ''}
              onClick={() => setActiveTab('logs')}
            >
              <Terminal size={16} />
              Логи
            </button>
          </div>

          <div className="toolbar-actions">
            <button type="button" onClick={copyCode}>
              {copied ? <Check size={16} /> : <Copy size={16} />}
              {copied ? 'Скопировано' : 'Копировать'}
            </button>
            <button type="button" className="primary-action" onClick={runPreview}>
              <Play size={16} />
              Запуск
            </button>
          </div>
        </div>

        <div className="panel">
          {activeTab === 'preview' && (
            <iframe title="HTML preview" srcDoc={code} sandbox="allow-scripts" />
          )}

          {activeTab === 'editor' && (
            <div className="editor">
              <div className="line-numbers" aria-hidden="true">
                {lineNumbers.map((line) => (
                  <span key={line}>{line}</span>
                ))}
              </div>
              <textarea
                value={code}
                onChange={(event) => setCode(event.target.value)}
                spellCheck="false"
                aria-label="HTML-код песочницы"
              />
            </div>
          )}

          {activeTab === 'logs' && (
            <div className="logs">
              <div className="logs-title">
                <FileText size={18} />
                Журнал действий
              </div>
              {logs.map((log, index) => (
                <p key={`${log}-${index}`}>{log}</p>
              ))}
            </div>
          )}
        </div>
      </section>
    </main>
  );
}
