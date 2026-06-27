// AI backend abstraction. Returns an object with the same shape regardless
// of the underlying engine. Set AI_BACKEND in .env to pick one:
//   - ollama   (default model OLLAMA_MODEL, default host OLLAMA_HOST)
//   - lmstudio (default model LM_STUDIO_MODEL, default host LM_STUDIO_HOST,
//               optional bearer token LM_STUDIO_API_KEY)
//   - none     (no AI; /api/ai/* returns 503 with a clear message)
//
// Common interface:
//   name:         string
//   defaultModel: string
//   listModels(): Promise<string[]>
//   chat({ system, messages, model, signal }): AsyncIterable<{ content: string, done: boolean }>

const NONE_BACKEND = {
  name: 'none',
  defaultModel: '',
  async listModels() {
    return [];
  },
  async *chat() {
    throw new Error('AI backend not configured. Set AI_BACKEND=ollama or AI_BACKEND=lmstudio.');
    // eslint-disable-next-line no-unreachable
    yield { content: '', done: true };
  },
};

async function makeOllamaBackend({ host, defaultModel }) {
  let Ollama;
  try {
    // Dynamic import so the dep is only required when actually used.
    ({ Ollama } = await import('ollama'));
  } catch {
    throw new Error(
      "AI_BACKEND=ollama but the 'ollama' package is not installed. Run `npm install ollama`."
    );
  }
  const client = new Ollama({ host });
  return {
    name: 'ollama',
    defaultModel,
    async listModels() {
      const { models } = await client.list();
      return models.map((m) => m.name).sort();
    },
    async *chat({ system, messages, model, signal }) {
      const stream = await client.chat({
        model: model || defaultModel,
        messages: [{ role: 'system', content: system }, ...messages],
        stream: true,
        ...(signal ? { signal } : {}),
      });
      for await (const chunk of stream) {
        if (signal?.aborted) return;
        const content = chunk.message?.content || '';
        if (content) yield { content, done: false };
        if (chunk.done) yield { content: '', done: true };
      }
    },
  };
}

function makeLMStudioBackend({ host, apiKey, defaultModel }) {
  const headers = { 'Content-Type': 'application/json' };
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`;

  return {
    name: 'lmstudio',
    defaultModel,
    async listModels() {
      const r = await fetch(`${host}/v1/models`, { headers: { ...headers } });
      const d = await r.json();
      return (d.data || []).map((m) => m.id).sort();
    },
    async *chat({ system, messages, model, signal }) {
      const r = await fetch(`${host}/v1/chat/completions`, {
        method: 'POST',
        headers: { ...headers },
        body: JSON.stringify({
          model: model || defaultModel,
          messages: [{ role: 'system', content: system }, ...messages],
          stream: true,
        }),
        ...(signal ? { signal } : {}),
      });
      if (!r.ok || !r.body) {
        const text = await r.text().catch(() => '');
        throw new Error(`LM Studio ${r.status}: ${text || r.statusText}`);
      }
      const decoder = new TextDecoder();
      let buf = '';
      for await (const raw of r.body) {
        if (signal?.aborted) return;
        buf += decoder.decode(raw, { stream: true });
        const lines = buf.split('\n');
        buf = lines.pop();
        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          const payload = line.slice(6).trim();
          if (payload === '[DONE]') {
            yield { content: '', done: true };
            continue;
          }
          let delta;
          try {
            delta = JSON.parse(payload).choices?.[0]?.delta?.content || '';
          } catch {
            continue;
          }
          if (delta) yield { content: delta, done: false };
        }
      }
    },
  };
}

export async function getAIBackend() {
  const which = (process.env.AI_BACKEND || 'none').toLowerCase();
  if (which === 'ollama') {
    return makeOllamaBackend({
      host: process.env.OLLAMA_HOST || 'http://127.0.0.1:11434',
      defaultModel: process.env.OLLAMA_MODEL || 'gemma3:12b',
    });
  }
  if (which === 'lmstudio') {
    return makeLMStudioBackend({
      host: process.env.LM_STUDIO_HOST || 'http://127.0.0.1:1234',
      apiKey: process.env.LM_STUDIO_API_KEY || '',
      defaultModel: process.env.LM_STUDIO_MODEL || 'local-model',
    });
  }
  return NONE_BACKEND;
}
