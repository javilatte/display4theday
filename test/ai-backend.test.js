import { test, beforeEach, after, describe } from 'node:test';
import assert from 'node:assert/strict';

// We exercise getAIBackend with a controlled AI_BACKEND env, and stub
// globalThis.fetch only for the LM Studio path. The Ollama path uses
// dynamic import of the 'ollama' package which is installed in package.json.

const savedEnv = { ...process.env };

beforeEach(() => {
  // Reset the relevant vars before each test
  delete process.env.AI_BACKEND;
  delete process.env.OLLAMA_HOST;
  delete process.env.OLLAMA_MODEL;
  delete process.env.LM_STUDIO_HOST;
  delete process.env.LM_STUDIO_API_KEY;
  delete process.env.LM_STUDIO_MODEL;
});

after(() => {
  process.env = savedEnv;
});

describe('getAIBackend()', () => {
  test('returns the "none" backend by default', async () => {
    const { getAIBackend } = await import('../ai/backend.js');
    const ai = await getAIBackend();
    assert.equal(ai.name, 'none');
    assert.deepEqual(await ai.listModels(), []);
  });

  test('returns the "none" backend when AI_BACKEND is unknown', async () => {
    process.env.AI_BACKEND = 'gpt-9000';
    const { getAIBackend } = await import('../ai/backend.js?v=unknown');
    const ai = await getAIBackend();
    assert.equal(ai.name, 'none');
  });

  test('"none" backend throws on chat', async () => {
    const { getAIBackend } = await import('../ai/backend.js?v=thrownone');
    const ai = await getAIBackend();
    await assert.rejects(async () => {
      for await (const _ of ai.chat({ system: 's', messages: [], model: 'm' })) {
        // should not reach here
      }
    }, /AI backend not configured/);
  });

  test('returns the ollama backend with correct defaults', async () => {
    process.env.AI_BACKEND = 'ollama';
    process.env.OLLAMA_HOST = 'http://ollama.local:11434';
    process.env.OLLAMA_MODEL = 'llama3:8b';
    const { getAIBackend } = await import('../ai/backend.js?v=ollama-defaults');
    const ai = await getAIBackend();
    assert.equal(ai.name, 'ollama');
    assert.equal(ai.defaultModel, 'llama3:8b');
  });

  test('ollama backend uses default host when not set', async () => {
    process.env.AI_BACKEND = 'ollama';
    const { getAIBackend } = await import('../ai/backend.js?v=ollama-nohost');
    const ai = await getAIBackend();
    assert.equal(ai.name, 'ollama');
    assert.equal(ai.defaultModel, 'gemma3:12b'); // package default
  });

  test('returns the lmstudio backend with correct defaults', async () => {
    process.env.AI_BACKEND = 'lmstudio';
    process.env.LM_STUDIO_HOST = 'http://lms.local:9999';
    process.env.LM_STUDIO_MODEL = 'mistral-7b';
    const { getAIBackend } = await import('../ai/backend.js?v=lmstudio-cfg');
    const ai = await getAIBackend();
    assert.equal(ai.name, 'lmstudio');
    assert.equal(ai.defaultModel, 'mistral-7b');
  });

  test('lmstudio backend uses default host when not set', async () => {
    process.env.AI_BACKEND = 'lmstudio';
    const { getAIBackend } = await import('../ai/backend.js?v=lmstudio-nohost');
    const ai = await getAIBackend();
    assert.equal(ai.name, 'lmstudio');
    assert.equal(ai.defaultModel, 'local-model');
  });

  test('lmstudio listModels hits /v1/models and returns ids', async () => {
    process.env.AI_BACKEND = 'lmstudio';
    process.env.LM_STUDIO_HOST = 'http://lms.test:1234';
    process.env.LM_STUDIO_API_KEY = 'secret-token';

    const calls = [];
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (url, opts) => {
      calls.push({ url, opts });
      return new Response(JSON.stringify({ data: [{ id: 'b' }, { id: 'a' }, { id: 'c' }] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    };
    try {
      const { getAIBackend } = await import('../ai/backend.js?v=lmstudio-list');
      const ai = await getAIBackend();
      const models = await ai.listModels();
      assert.deepEqual(models, ['a', 'b', 'c']);
      assert.equal(calls.length, 1);
      assert.equal(calls[0].url, 'http://lms.test:1234/v1/models');
      assert.equal(calls[0].opts.headers.Authorization, 'Bearer secret-token');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test('lmstudio listModels works without API key', async () => {
    process.env.AI_BACKEND = 'lmstudio';
    process.env.LM_STUDIO_HOST = 'http://lms.test:1234';

    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (url, opts) => {
      assert.equal(opts.headers.Authorization, undefined);
      return new Response(JSON.stringify({ data: [] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    };
    try {
      const { getAIBackend } = await import('../ai/backend.js?v=lmstudio-nokey');
      const ai = await getAIBackend();
      const models = await ai.listModels();
      assert.deepEqual(models, []);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test('lmstudio chat parses SSE stream and yields deltas', async () => {
    process.env.AI_BACKEND = 'lmstudio';
    process.env.LM_STUDIO_HOST = 'http://lms.test:1234';

    const sseChunks = [
      'data: {"choices":[{"delta":{"content":"Hola"}}]}\n\n',
      'data: {"choices":[{"delta":{"content":"<think>"}}]}\n\n',
      'data: {"choices":[{"delta":{"content":"razonamiento interno"}}]}\n\n',
      'data: {"choices":[{"delta":{"content":"</think>"}}]}\n\n',
      'data: {"choices":[{"delta":{"content":" mundo"}}]}\n\n',
      'data: [DONE]\n\n',
    ];
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      start(controller) {
        for (const chunk of sseChunks) {
          controller.enqueue(encoder.encode(chunk));
        }
        controller.close();
      },
    });

    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => ({ ok: true, status: 200, body: stream });
    try {
      const { getAIBackend } = await import('../ai/backend.js?v=lmstudio-chat');
      const ai = await getAIBackend();
      const out = [];
      for await (const { content } of ai.chat({ system: 's', messages: [], model: 'm' })) {
        out.push(content);
      }
      // Backend yields raw deltas; <think> stripping is server.js's job.
      // The last '' is the [DONE] terminator the backend emits.
      assert.deepEqual(out, ['Hola', '<think>', 'razonamiento interno', '</think>', ' mundo', '']);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
