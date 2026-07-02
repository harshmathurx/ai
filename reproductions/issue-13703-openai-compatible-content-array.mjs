import { createServer } from 'node:http';
import assert from 'node:assert/strict';
import { inspect } from 'node:util';
import { createOpenAICompatible } from '../packages/openai-compatible/dist/index.js';

const prompt = [{ role: 'user', content: [{ type: 'text', text: 'Hello' }] }];

function startServer() {
  const server = createServer(async (req, res) => {
    if (req.method !== 'POST' || req.url !== '/v1/chat/completions') {
      res.writeHead(404).end('not found');
      return;
    }

    let rawBody = '';
    for await (const chunk of req) rawBody += chunk;
    const body = JSON.parse(rawBody);

    if (body.stream) {
      res.writeHead(200, {
        'content-type': 'text/event-stream',
        'cache-control': 'no-cache',
        connection: 'keep-alive',
      });
      res.write(
        `data: ${JSON.stringify({
          id: 'issue-13703-stream',
          object: 'chat.completion.chunk',
          created: 1711115037,
          model: 'mistral-small-latest',
          choices: [
            {
              index: 0,
              delta: {
                content: [
                  {
                    type: 'thinking',
                    thinking: [{ type: 'text', text: 'Hello' }],
                  },
                ],
              },
              finish_reason: null,
            },
          ],
        })}\n\n`,
      );
      res.write('data: [DONE]\n\n');
      res.end();
      return;
    }

    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(
      JSON.stringify({
        id: 'issue-13703-generate',
        object: 'chat.completion',
        created: 1711115037,
        model: 'mistral-small-latest',
        choices: [
          {
            index: 0,
            message: {
              role: 'assistant',
              content: [
                {
                  type: 'thinking',
                  thinking: [{ type: 'text', text: 'Hello' }],
                },
              ],
            },
            finish_reason: 'stop',
          },
        ],
        usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
      }),
    );
  });

  return new Promise(resolve => {
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      resolve({ server, baseURL: `http://127.0.0.1:${port}/v1` });
    });
  });
}

async function expectValidationFailure(label, fn) {
  try {
    await fn();
  } catch (error) {
    const message = String(error?.message ?? error);
    const details = `${message}\n${inspect(error, { depth: 8 })}`;
    assert.match(
      details,
      /validation|Invalid response data|Type validation failed|Invalid JSON response/i,
      `${label} failed, but not with a response validation error:\n${details}`,
    );
    assert.match(
      details,
      /expected string|Invalid input|received array|array/i,
      `${label} validation error did not mention the array content shape:\n${details}`,
    );
    console.log(`${label}: reproduced validation failure`);
    console.log(details.split('\n').slice(0, 12).join('\n'));
    return;
  }

  throw new Error(
    `${label}: expected @ai-sdk/openai-compatible to reject array content, but it succeeded`,
  );
}

async function expectStreamValidationError(label, fn) {
  const parts = await fn();
  const errorPart = parts.find(part => part.type === 'error');
  assert.ok(
    errorPart,
    `${label}: expected a stream error part for array content, got:\n${inspect(parts, { depth: 8 })}`,
  );

  const details = inspect(errorPart.error, { depth: 8 });
  assert.match(
    details,
    /validation|Type validation failed|expected.*string|array/i,
    `${label} error part did not contain a response validation error:\n${details}`,
  );
  console.log(`${label}: reproduced validation error part`);
  console.log(details.split('\n').slice(0, 12).join('\n'));
}

const { server, baseURL } = await startServer();

try {
  const provider = createOpenAICompatible({
    name: 'issue-13703',
    baseURL,
    apiKey: 'test-key',
  });
  const model = provider('mistral-small-latest');

  await expectValidationFailure('doGenerate', async () => {
    await model.doGenerate({ prompt });
  });

  await expectStreamValidationError('doStream', async () => {
    const { stream } = await model.doStream({ prompt });
    const reader = stream.getReader();
    const parts = [];
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        parts.push(value);
      }
    } finally {
      reader.releaseLock();
    }
    return parts;
  });
} finally {
  await new Promise(resolve => server.close(resolve));
}
