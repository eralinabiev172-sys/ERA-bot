import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Bug,
  Check,
  Code,
  Copy,
  FileText,
  Layout,
  Lightbulb,
  Mic,
  MicOff,
  Monitor,
  Plus,
  Play,
  RefreshCw,
  Send,
  Settings,
  Sparkles,
  Terminal,
  TerminalSquare,
  Trash2,
} from 'lucide-react';
import './App.css';

const FALLBACK_LOCAL_API_URL = `http://${window.location.hostname || '127.0.0.1'}:8000`;
const IS_LOCAL_ENV = ['localhost', '127.0.0.1'].includes(window.location.hostname);
const API_BASE_URL = (import.meta.env.VITE_API_URL || (IS_LOCAL_ENV ? FALLBACK_LOCAL_API_URL : '')).replace(/\/$/, '');
const API_URL = API_BASE_URL ? `${API_BASE_URL}/api/chat` : '/api/chat';
const API_HEALTH_URL = API_BASE_URL ? `${API_BASE_URL}/api/health` : '/api/health';
const BACKEND_HINT = API_BASE_URL ? `Backend endpoint: ${API_BASE_URL}` : 'Backend endpoint: /api';
const BACKEND_HELP_TEXT = IS_LOCAL_ENV
  ? 'Local AI mode: run backend with python assistant_backend_api.py'
  : 'Vercel mode: add GEMINI_API_KEY in Project Settings.';

const VOICE_PROFILES = {
  peer: {
    label: 'Живой помощник',
    rate: 1.08,
    femalePitch: 1.14,
    malePitch: 0.98,
  },
  calm: {
    label: 'Спокойный помощник',
    rate: 0.96,
    femalePitch: 1.02,
    malePitch: 0.9,
  },
};

const welcomeMessage = {
  role: 'assistant',
  type: 'text',
  content:
    'Привет! Я Эра Бот, твой персональный AI-ассистент и напарник по программированию. Напиши задачу, выбери быстрый шаблон или отправь код в редактор справа.',
};

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
        background: #0f172a;
      }
      main {
        width: min(92vw, 720px);
        padding: 36px;
        border: 1px solid rgba(148, 163, 184, 0.28);
        border-radius: 18px;
        background: rgba(15, 23, 42, 0.92);
      }
      h1 { margin: 0 0 12px; font-size: 48px; }
      p { margin: 0 0 24px; color: #cbd5e1; font-size: 18px; }
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

function parseMessageContent(content) {
  const parts = [];
  const regex = /```(\w*)\n([\s\S]*?)```/g;
  let lastIndex = 0;
  let match;

  while ((match = regex.exec(content)) !== null) {
    if (match.index > lastIndex) {
      parts.push({ type: 'text', value: content.slice(lastIndex, match.index) });
    }

    parts.push({
      type: 'code',
      lang: match[1] || 'code',
      value: match[2],
    });
    lastIndex = regex.lastIndex;
  }

  if (lastIndex < content.length) {
    parts.push({ type: 'text', value: content.slice(lastIndex) });
  }

  return parts.length ? parts : [{ type: 'text', value: content }];
}

function languageFromBlock(lang) {
  const normalized = lang.toLowerCase();
  if (['html', 'xml', 'svg'].includes(normalized)) return 'html';
  if (['js', 'javascript'].includes(normalized)) return 'javascript';
  if (['py', 'python'].includes(normalized)) return 'python';
  if (normalized === 'css') return 'css';
  return normalized || 'javascript';
}

function getPreferredVoice(voices, preferredGender) {
  if (!voices.length) return null;

  const voicePatterns =
    preferredGender === 'male'
      ? [/male/i, /man/i, /pavel/i, /aleks/i, /dmit/i, /igor/i, /maxim/i]
      : [/female/i, /woman/i, /anna/i, /alena/i, /irina/i, /maria/i, /julia/i];

  return voices.find((voice) => voicePatterns.some((pattern) => pattern.test(voice.name))) || voices[0];
}

export default function App() {
  const [messages, setMessages] = useState([welcomeMessage]);
  const [inputText, setInputText] = useState('');
  const [isListening, setIsListening] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [backendStatus, setBackendStatus] = useState('checking');
  const [isVoiceReplyEnabled, setIsVoiceReplyEnabled] = useState(true);
  const [voiceProfile, setVoiceProfile] = useState('peer');
  const [availableVoices, setAvailableVoices] = useState([]);
  const [copiedIndex, setCopiedIndex] = useState(null);
  const [code, setCode] = useState(starterCode);
  const [language, setLanguage] = useState('html');
  const [activeTab, setActiveTab] = useState('editor');
  const [isWorkspaceOpen, setIsWorkspaceOpen] = useState(false);
  const [isQuickActionsOpen, setIsQuickActionsOpen] = useState(false);
  const [terminalLogs, setTerminalLogs] = useState([BACKEND_HINT, 'Terminal ready.', BACKEND_HELP_TEXT]);
  const [isCopiedCode, setIsCopiedCode] = useState(false);

  const canvasRef = useRef(null);
  const audioContextRef = useRef(null);
  const analyserRef = useRef(null);
  const dataArrayRef = useRef(null);
  const sourceRef = useRef(null);
  const animationFrameRef = useRef(null);
  const chatEndRef = useRef(null);
  const recognitionRef = useRef(null);
  const transcriptRef = useRef('');
  const lastSpokenMessageRef = useRef(-1);
  const silenceTimeoutRef = useRef(null);
  const manualStopRequestedRef = useRef(false);

  const lineNumbers = useMemo(() => {
    return Array.from({ length: Math.max(code.split('\n').length, 1) }, (_, index) => index + 1);
  }, [code]);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  useEffect(() => {
    let isCancelled = false;

    const checkBackend = async () => {
      try {
        const response = await fetch(API_HEALTH_URL);
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }

        const data = await response.json();
        if (isCancelled) return;
        setBackendStatus(data.gemini_configured ? 'online' : 'warning');
      } catch {
        if (isCancelled) return;
        setBackendStatus('offline');
      }
    };

    checkBackend();
    const intervalId = window.setInterval(checkBackend, 5000);

    return () => {
      isCancelled = true;
      window.clearInterval(intervalId);
    };
  }, []);

  useEffect(() => {
    const synth = window.speechSynthesis;
    if (!synth) return undefined;

    const updateVoices = () => {
      const voices = synth.getVoices().filter((voice) => voice.lang?.toLowerCase().startsWith('ru'));
      setAvailableVoices(voices);
    };

    updateVoices();
    synth.addEventListener?.('voiceschanged', updateVoices);

    return () => {
      synth.removeEventListener?.('voiceschanged', updateVoices);
    };
  }, []);

  useEffect(() => {
    return () => {
      if (animationFrameRef.current) cancelAnimationFrame(animationFrameRef.current);
      if (audioContextRef.current?.state !== 'closed') audioContextRef.current?.close();
      if (silenceTimeoutRef.current) window.clearTimeout(silenceTimeoutRef.current);
      window.speechSynthesis?.cancel();
    };
  }, []);

  useEffect(() => {
    if (!isVoiceReplyEnabled) {
      window.speechSynthesis?.cancel();
      return;
    }

    const lastMessageIndex = messages.length - 1;
    const lastMessage = messages[lastMessageIndex];
    if (!lastMessage || lastMessage.role !== 'assistant' || lastMessageIndex === lastSpokenMessageRef.current) {
      return;
    }

    const speechText = lastMessage.content
      .replace(/```[\s\S]*?```/g, '')
      .replace(/\s+/g, ' ')
      .trim();

    if (!speechText) return;

    lastSpokenMessageRef.current = lastMessageIndex;
    window.speechSynthesis?.cancel();

    const profile = VOICE_PROFILES[voiceProfile] || VOICE_PROFILES.peer;
    const utterance = new SpeechSynthesisUtterance(speechText);
    utterance.lang = 'ru-RU';
    utterance.rate = profile.rate;
    utterance.pitch = profile.malePitch;

    const preferredVoice = getPreferredVoice(availableVoices, 'male');
    if (preferredVoice) {
      utterance.voice = preferredVoice;
    }

    window.speechSynthesis?.speak(utterance);
  }, [availableVoices, isVoiceReplyEnabled, messages, voiceProfile]);

  const drawVisualizer = (volume) => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    const width = canvas.width;
    const height = canvas.height;
    const centerX = width / 2;
    const centerY = height / 2;
    const baseRadius = 19;
    const activeRadius = baseRadius + volume * 0.28;

    ctx.clearRect(0, 0, width, height);
    ctx.beginPath();
    ctx.arc(centerX, centerY, activeRadius + 10, 0, 2 * Math.PI);
    const gradient = ctx.createRadialGradient(
      centerX,
      centerY,
      activeRadius,
      centerX,
      centerY,
      activeRadius + 18,
    );
    gradient.addColorStop(0, 'rgba(56, 189, 248, 0.45)');
    gradient.addColorStop(1, 'rgba(56, 189, 248, 0)');
    ctx.fillStyle = gradient;
    ctx.fill();

    ctx.beginPath();
    ctx.arc(centerX, centerY, activeRadius, 0, 2 * Math.PI);
    ctx.fillStyle = isProcessing ? '#f59e0b' : '#38bdf8';
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = '#ffffff';
    ctx.stroke();
  };

  const renderVisualizerLoop = () => {
    if (!analyserRef.current || !dataArrayRef.current) return;

    analyserRef.current.getByteFrequencyData(dataArrayRef.current);
    const sum = dataArrayRef.current.reduce((total, value) => total + value, 0);
    drawVisualizer(sum / dataArrayRef.current.length);
    animationFrameRef.current = requestAnimationFrame(renderVisualizerLoop);
  };

  const resetSilenceTimer = () => {
    if (silenceTimeoutRef.current) {
      window.clearTimeout(silenceTimeoutRef.current);
    }

    silenceTimeoutRef.current = window.setTimeout(() => {
      if (recognitionRef.current) {
        recognitionRef.current.stop();
      }
    }, 1800);
  };

  const stopListening = (manual = true) => {
    manualStopRequestedRef.current = manual;

    sourceRef.current?.mediaStream.getTracks().forEach((track) => track.stop());
    if (audioContextRef.current?.state !== 'closed') audioContextRef.current?.close();
    if (animationFrameRef.current) cancelAnimationFrame(animationFrameRef.current);
    if (silenceTimeoutRef.current) {
      window.clearTimeout(silenceTimeoutRef.current);
      silenceTimeoutRef.current = null;
    }

    recognitionRef.current?.stop();
    recognitionRef.current = null;
    setIsListening(false);
    drawVisualizer(0);

    if (manual) {
      setTerminalLogs((current) => [...current, 'Микрофон выключен.']);
    }
  };

  const handleSend = async (customText = null) => {
    const textToSend = (customText || inputText).trim();
    if (!textToSend || isProcessing) return;

    const userMessage = { role: 'user', content: textToSend, type: 'text' };
    const nextMessages = [...messages, userMessage];

    setMessages(nextMessages);
    if (!customText) setInputText('');
    setIsProcessing(true);
    drawVisualizer(16);
    setTerminalLogs((current) => [...current, `> ${textToSend}`]);

    try {
      const response = await fetch(API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: nextMessages.map(({ role, content }) => ({ role, content })),
          currentCode: code,
          language,
        }),
      });

      if (!response.ok) {
        let details = response.statusText;
        try {
          const data = await response.json();
          details = data.detail || details;
        } catch {
          // Keep status text
        }
        throw new Error(details);
      }

      setBackendStatus('online');
      const data = await response.json();
      const assistantMessage = {
        role: 'assistant',
        content: data.content,
        type: data.type || 'text',
        actionType: data.action_type,
      };

      setMessages((current) => [...current, assistantMessage]);
      setTerminalLogs((current) => [...current, 'Ответ AI получен.']);
    } catch (error) {
      if (error instanceof TypeError) {
        setBackendStatus('offline');
      }

      const errorMessage =
        error instanceof TypeError
          ? IS_LOCAL_ENV
            ? `Cannot connect to backend at ${API_BASE_URL}. Run it in the project folder: python assistant_backend_api.py`
            : 'Cannot connect to the Vercel API backend. Check the serverless deployment and the GEMINI_API_KEY environment variable.'
          : error.message;

      setMessages((current) => [
        ...current,
        {
          role: 'assistant',
          type: 'text',
          content: `Не смог получить ответ от AI. ${errorMessage}`,
        },
      ]);
      setTerminalLogs((current) => [...current, `Ошибка: ${errorMessage}`]);
    } finally {
      setIsProcessing(false);
      drawVisualizer(0);
    }
  };

  const startListening = async () => {
    try {
      if (isListening) return;

      const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
      if (!SpeechRecognition) {
        setTerminalLogs((current) => [...current, 'Голосовой ввод не поддерживается в этом браузере.']);
        return;
      }

      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      audioContextRef.current = new (window.AudioContext || window.webkitAudioContext)();
      analyserRef.current = audioContextRef.current.createAnalyser();
      analyserRef.current.fftSize = 256;
      sourceRef.current = audioContextRef.current.createMediaStreamSource(stream);
      sourceRef.current.connect(analyserRef.current);
      dataArrayRef.current = new Uint8Array(analyserRef.current.frequencyBinCount);

      const recognition = new SpeechRecognition();
      recognition.lang = 'ru-RU';
      recognition.interimResults = true;
      recognition.continuous = false;

      transcriptRef.current = '';
      manualStopRequestedRef.current = false;

      recognition.onresult = (event) => {
        let interimText = '';
        let finalText = transcriptRef.current;

        for (let index = event.resultIndex; index < event.results.length; index += 1) {
          const result = event.results[index];
          const text = result[0]?.transcript ?? '';
          if (result.isFinal) {
            finalText += `${text} `;
          } else {
            interimText += text;
          }
        }

        transcriptRef.current = finalText;
        setInputText(`${finalText}${interimText}`.trim());
        resetSilenceTimer();
      };

      recognition.onerror = (event) => {
        setTerminalLogs((current) => [...current, `Ошибка распознавания речи: ${event.error}`]);
      };

      recognition.onend = () => {
        const finalText = transcriptRef.current.trim();
        recognitionRef.current = null;

        if (silenceTimeoutRef.current) {
          window.clearTimeout(silenceTimeoutRef.current);
          silenceTimeoutRef.current = null;
        }

        setIsListening(false);
        drawVisualizer(0);
        sourceRef.current?.mediaStream.getTracks().forEach((track) => track.stop());
        if (audioContextRef.current?.state !== 'closed') audioContextRef.current?.close();

        if (manualStopRequestedRef.current && !finalText) {
          setTerminalLogs((current) => [...current, 'Голосовой ввод остановлен.']);
          return;
        }

        if (finalText) {
          setInputText(finalText);
          setTerminalLogs((current) => [...current, `Речь распознана: ${finalText}`]);
          handleSend(finalText);
        } else {
          setTerminalLogs((current) => [...current, 'Голосовой ввод остановлен без распознанного текста.']);
        }
      };

      recognitionRef.current = recognition;
      setIsListening(true);
      renderVisualizerLoop();
      setTerminalLogs((current) => [...current, 'Микрофон включен.']);
      resetSilenceTimer();
      recognition.start();
    } catch (error) {
      setTerminalLogs((current) => [...current, `Ошибка микрофона: ${error.message}`]);
    }
  };

  const handlePushToTalkStart = () => {
    if (!isListening) {
      startListening();
    }
  };

  const handlePushToTalkEnd = () => {
    if (isListening) {
      stopListening(true);
    }
  };

  const copyToEditor = (codeText, lang) => {
    const nextLanguage = languageFromBlock(lang);
    setCode(codeText.trim());
    setLanguage(nextLanguage);
    setActiveTab(nextLanguage === 'html' ? 'preview' : 'editor');
    setIsWorkspaceOpen(true);
    setTerminalLogs((current) => [
      ...current,
      `Проект импортирован из чата (${nextLanguage}).`,
    ]);
  };

  const copyToClipboard = async (text, index) => {
    await navigator.clipboard.writeText(text);
    setCopiedIndex(index);
    setTimeout(() => setCopiedIndex(null), 1400);
  };

  const copyWorkspaceCode = async () => {
    await navigator.clipboard.writeText(code);
    setIsCopiedCode(true);
    setTimeout(() => setIsCopiedCode(false), 1400);
  };

  const runCode = () => {
    if (language === 'html') {
      setActiveTab('preview');
      setIsWorkspaceOpen(true);
      setTerminalLogs((current) => [...current, 'HTML-preview обновлен.']);
      return;
    }

    setActiveTab('terminal');
    setIsWorkspaceOpen(true);
    setTerminalLogs((current) => [
      ...current,
      `Запуск ${language} пока работает как предпросмотр кода. Для выполнения нужен отдельный runner.`,
    ]);
  };

  const handleAIAction = (action) => {
    const prompts = {
      explain: `Объясни этот код простыми словами:\n\n\`\`\`${language}\n${code}\n\`\`\``,
      bug: `Найди ошибки в этом коде и предложи исправления:\n\n\`\`\`${language}\n${code}\n\`\`\``,
      refactor: `Проведи рефакторинг этого кода. Сделай его чище и выдай обновленную полную версию:\n\n\`\`\`${language}\n${code}\n\`\`\``,
      test: `Напиши тесты или тест-кейсы для этого кода:\n\n\`\`\`${language}\n${code}\n\`\`\``,
    };

    handleSend(prompts[action]);
    setIsQuickActionsOpen(false);
  };

  const renderAssistantContent = (message, messageIndex) => {
    if (message.type === 'action') {
      const Icon = message.actionType === 'smarthome' ? Lightbulb : Monitor;
      return (
        <span className="action-message">
          <Icon size={17} />
          {message.content}
        </span>
      );
    }

    return parseMessageContent(message.content).map((part, partIndex) => {
      if (part.type === 'code') {
        const index = `${messageIndex}-${partIndex}`;
        const isHtml = languageFromBlock(part.lang) === 'html';

        return (
          <div className="code-block" key={index}>
            <div className="code-block-toolbar">
              <span>{part.lang || 'code'}</span>
              <div>
                <button type="button" onClick={() => copyToEditor(part.value, part.lang)}>
                  <Code size={14} />
                  {isHtml ? 'Запустить проект' : 'В редактор'}
                </button>
                <button type="button" onClick={() => copyToClipboard(part.value, index)}>
                  {copiedIndex === index ? <Check size={14} /> : <Copy size={14} />}
                </button>
              </div>
            </div>
            <pre>
              <code>{part.value}</code>
            </pre>
          </div>
        );
      }

      return (
        <span className="message-text" key={`${messageIndex}-${partIndex}`}>
          {part.value}
        </span>
      );
    });
  };

  return (
    <div className="assistant-app">
      <header className="topbar">
        <div className="topbar-brand">
          <div className="topbar-icon">
            <TerminalSquare size={20} />
          </div>
          <div>
            <h1>Эра Бот</h1>
            <span>v2.5 Coder</span>
          </div>
        </div>

        <div className="topbar-actions">
              <button
                type="button"
                className="burger-button"
                title="Открыть Кодекс"
                onClick={() => setIsWorkspaceOpen((current) => !current)}
              >
                {isWorkspaceOpen ? 'Закрыть' : 'Кодекс'}
              </button>
          <button
            type="button"
            title={isVoiceReplyEnabled ? 'Отключить голосовой ответ' : 'Включить голосовой ответ'}
            onClick={() => setIsVoiceReplyEnabled((current) => !current)}
          >
            {isVoiceReplyEnabled ? 'Голос вкл' : 'Голос выкл'}
          </button>
          <div className={`connection-pill ${backendStatus}`} title={API_BASE_URL}>
            <span />
            {backendStatus === 'online' && 'Backend online'}
            {backendStatus === 'warning' && 'Backend online, key missing'}
            {backendStatus === 'offline' && 'Backend offline'}
            {backendStatus === 'checking' && 'Checking backend'}
          </div>
          <button type="button" title="Настройки">
            <Settings size={17} />
          </button>
        </div>
      </header>

      {isWorkspaceOpen && <button type="button" className="workspace-backdrop" onClick={() => setIsWorkspaceOpen(false)} />}

      <main className="main-grid">
        <section className="chat-panel" aria-label="Чат с Era Bot">
          <div className="bot-strip">
            <canvas ref={canvasRef} width={64} height={64} />
            <div>
              <strong>Эра Бот</strong>
              <span>
                {isListening
                  ? 'Слушаю микрофон...'
                  : isProcessing
                    ? 'Думаю над задачей...'
                    : 'Ожидаю запрос'}
              </span>
            </div>
            <button
              className={isListening ? 'mic-button active' : 'mic-button'}
              type="button"
              onClick={isListening ? () => stopListening(true) : startListening}
              title="Микрофон"
            >
              {isListening ? <MicOff size={17} /> : <Mic size={17} />}
            </button>
          </div>

          <div className="chat-list">
            {messages.map((message, index) => (
              <article className={`message ${message.role} ${message.type}`} key={`${message.role}-${index}`}>
                {message.role === 'assistant' ? renderAssistantContent(message, index) : message.content}
              </article>
            ))}

            {isProcessing && (
              <article className="message assistant loading-message">
                <Sparkles size={16} />
                Думаю...
              </article>
            )}
            <div ref={chatEndRef} />
          </div>

          <div className={isQuickActionsOpen ? 'quick-actions quick-actions-open' : 'quick-actions'}>
            <button type="button" onClick={() => handleAIAction('explain')}>
              <FileText size={15} />
              Объяснить
            </button>
            <button type="button" onClick={() => handleAIAction('bug')}>
              <Bug size={15} />
              Ошибки
            </button>
            <button type="button" onClick={() => handleAIAction('refactor')}>
              <RefreshCw size={15} />
              Рефактор
            </button>
            <button type="button" onClick={() => handleAIAction('test')}>
              <Sparkles size={15} />
              Тесты
            </button>
            <button
              type="button"
              onMouseDown={handlePushToTalkStart}
              onMouseUp={handlePushToTalkEnd}
              onMouseLeave={handlePushToTalkEnd}
              onTouchStart={handlePushToTalkStart}
              onTouchEnd={handlePushToTalkEnd}
            >
              {isListening ? 'Говорите...' : 'Нажми и говори'}
            </button>
          </div>

          <button
            type="button"
            className={isQuickActionsOpen ? 'quick-actions-toggle quick-actions-toggle-open' : 'quick-actions-toggle'}
            onClick={() => setIsQuickActionsOpen((current) => !current)}
            title="Быстрые действия"
          >
            <Plus size={18} />
          </button>

          <form
            className="composer"
            onSubmit={(event) => {
              event.preventDefault();
              handleSend();
            }}
          >
            <input
              value={inputText}
              onChange={(event) => setInputText(event.target.value)}
              placeholder="Задай вопрос по коду или отправь ТЗ..."
              aria-label="Сообщение для Era Bot"
            />
            <button type="submit" disabled={!inputText.trim() || isProcessing} title="Отправить">
              <Send size={18} />
            </button>
          </form>
        </section>

        <section
          className={isWorkspaceOpen ? 'workspace-panel workspace-panel-open' : 'workspace-panel'}
          aria-label="Среда программирования"
        >
          <div className="workspace-header">
            <div className="workspace-mobilebar">
              <strong>Кодекс</strong>
              <button type="button" onClick={() => setIsWorkspaceOpen(false)}>
                Закрыть
              </button>
            </div>
            <label className="language-select">
              <span>Язык</span>
              <select value={language} onChange={(event) => setLanguage(event.target.value)}>
                <option value="javascript">JavaScript</option>
                <option value="html">HTML</option>
                <option value="python">Python</option>
                <option value="cpp">C++</option>
                <option value="css">CSS</option>
              </select>
            </label>

            <div className="tabs">
              <button
                type="button"
                className={activeTab === 'editor' ? 'active' : ''}
                onClick={() => setActiveTab('editor')}
              >
                <Code size={16} />
                Редактор
              </button>
              <button
                type="button"
                className={activeTab === 'preview' ? 'active' : ''}
                onClick={() => setActiveTab('preview')}
                disabled={language !== 'html'}
              >
                <Layout size={16} />
                Превью
              </button>
              <button
                type="button"
                className={activeTab === 'terminal' ? 'active' : ''}
                onClick={() => setActiveTab('terminal')}
              >
                <Terminal size={16} />
                Вывод
              </button>
            </div>

            <div className="workspace-actions">
              <button type="button" onClick={copyWorkspaceCode}>
                {isCopiedCode ? <Check size={16} /> : <Copy size={16} />}
                Копировать
              </button>
              <button type="button" className="run-button" onClick={runCode}>
                <Play size={16} />
                Запуск
              </button>
            </div>
          </div>

          <div className="workspace-body">
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
                  aria-label="Редактор кода"
                />
              </div>
            )}

            {activeTab === 'preview' && language === 'html' && (
              <iframe title="HTML preview" srcDoc={code} sandbox="allow-scripts" />
            )}

            {activeTab === 'terminal' && (
              <div className="terminal-view">
                <div>
                  <p className="terminal-title">// Консоль вывода Era Bot</p>
                  {terminalLogs.map((log, index) => (
                    <p className={log.startsWith('Ошибка') ? 'error' : ''} key={`${log}-${index}`}>
                      {log}
                    </p>
                  ))}
                </div>
                <button type="button" onClick={() => setTerminalLogs(['Логи очищены.'])}>
                  <Trash2 size={15} />
                  Очистить консоль
                </button>
              </div>
            )}
          </div>

          <footer className="workspace-info">
            <span>INFO</span>
            {IS_LOCAL_ENV
              ? `Backend: ${API_BASE_URL}. Run assistant_backend_api.py separately so chat and local commands work reliably.`
              : 'Backend: /api. On Vercel the backend runs as a serverless API and needs GEMINI_API_KEY in Project Settings.'}
          </footer>
        </section>
      </main>
    </div>
  );
}
