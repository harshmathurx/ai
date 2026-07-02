import { strict as assert } from 'node:assert';
import { createOpenAICompatible } from '../dist/index.js';

const expectedError = {
  message: 'Context length exceeded',
  code: 'CONTEXT_LENGTH_EXCEEDED',
};

const provider = createOpenAICompatible({
  baseURL: 'http://example.test/v1',
  name: 'my-proxy',
  fetch: async () =>
    new Response(
      [
        `data: ${JSON.stringify({
          error: {
            ...expectedError,
            type: 'invalid_request_error',
          },
        })}`,
        '',
        'data: [DONE]',
        '',
      ].join('\n'),
      {
        status: 200,
        headers: { 'content-type': 'text/event-stream' },
      },
    ),
});

const result = await provider.chatModel('gpt-4').doStream({
  inputFormat: 'prompt',
  mode: { type: 'regular' },
  prompt: [{ role: 'user', content: [{ type: 'text', text: 'Hello' }] }],
  providerOptions: {},
});

let observedError;

for await (const part of result.stream) {
  if (part.type === 'error') {
    observedError = part.error;
    break;
  }
}

console.log('Observed SSE error part.error:', observedError);

assert.deepEqual(
  observedError,
  expectedError,
  'Expected OpenAI-compatible SSE error chunks to preserve error.code alongside message.',
);
