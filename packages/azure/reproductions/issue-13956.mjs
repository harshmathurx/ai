import assert from 'node:assert/strict';
import { createAzure } from '../dist/index.js';

// Reproduction for https://github.com/vercel/ai/issues/13956
// A corporate gateway supplies its own Azure routing/versioning and expects the
// SDK to use the explicit baseURL as-is for the endpoint path.
const expectedGatewayUrl =
  'https://our-gateway.example.com/azure/chat/completions';

let observedUrl;

const provider = createAzure({
  baseURL: 'https://our-gateway.example.com/azure',
  apiKey: 'test-api-key',
  fetch: async input => {
    observedUrl = input instanceof Request ? input.url : String(input);

    return new Response(
      JSON.stringify({
        id: 'chatcmpl-repro-13956',
        object: 'chat.completion',
        created: 0,
        model: 'test-deployment',
        choices: [
          {
            index: 0,
            message: { role: 'assistant', content: 'ok' },
            finish_reason: 'stop',
          },
        ],
        usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
      }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    );
  },
});

await provider.chat('test-deployment').doGenerate({
  prompt: [{ role: 'user', content: [{ type: 'text', text: 'Hello' }] }],
});

console.log('Observed URL:', observedUrl);
console.log('Expected gateway URL:', expectedGatewayUrl);

assert.equal(
  observedUrl,
  expectedGatewayUrl,
  'createAzure({ baseURL }) should not append /v1 or api-version for custom gateway URLs',
);
