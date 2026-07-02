import { createServer } from 'node:http';
import assert from 'node:assert/strict';

import { streamText } from '../packages/ai/dist/index.js';
import { createOpenAI } from '../packages/openai/dist/index.js';

const prompt = 'Write a poem about embedding models.';

function startOpenAICompatibleSseServer() {
  const server = createServer((request, response) => {
    let requestBody = '';

    request.setEncoding('utf8');
    request.on('data', chunk => {
      requestBody += chunk;
    });

    request.on('end', () => {
      console.log(`server received ${request.method} ${request.url}`);
      console.log(requestBody);

      response.writeHead(200, {
        'content-type': 'text/event-stream; charset=utf-8',
        'cache-control': 'no-cache',
        connection: 'keep-alive',
      });

      response.write(
        'data: {"id":"chatcmpl-13588","object":"chat.completion.chunk","created":0,"model":"test","choices":[{"index":0,"delta":{"role":"assistant","content":"hello"},"finish_reason":null}]}\n\n',
      );
      response.write(
        'data: {"id":"chatcmpl-13588","object":"chat.completion.chunk","created":0,"model":"test","choices":[{"index":0,"delta":{"content":" world"},"finish_reason":null}]}\n\n',
      );
      response.write(
        'data: {"id":"chatcmpl-13588","object":"chat.completion.chunk","created":0,"model":"test","choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}\n\n',
      );
      response.write('data: [DONE]\n\n');
      response.end();
    });
  });

  return new Promise(resolve => {
    server.listen(0, '127.0.0.1', () => {
      resolve(server);
    });
  });
}

async function runStreamText({ simulateExpoReactNative }) {
  const originalTextDecoderStream = globalThis.TextDecoderStream;

  if (simulateExpoReactNative) {
    // Expo React Native/Hermes does not expose TextDecoderStream in the
    // reporter's client environment. AI SDK streaming currently constructs one
    // while processing the successful SSE response.
    Object.defineProperty(globalThis, 'TextDecoderStream', {
      configurable: true,
      writable: true,
      value: undefined,
    });
  }

  const server = await startOpenAICompatibleSseServer();
  const { port } = server.address();

  try {
    const observedErrors = [];

    const { textStream } = streamText({
      model: createOpenAI({
        baseURL: `http://127.0.0.1:${port}/v1`,
        apiKey: 'lm-studio',
      }).chat('qwen/qwen3.5-9b'),
      prompt,
      onError({ error }) {
        observedErrors.push(error);
      },
    });

    let output = '';
    for await (const textPart of textStream) {
      output += textPart;
    }

    return { output, observedErrors };
  } finally {
    server.close();

    if (simulateExpoReactNative) {
      Object.defineProperty(globalThis, 'TextDecoderStream', {
        configurable: true,
        writable: true,
        value: originalTextDecoderStream,
      });
    }
  }
}

console.log('Control: Node.js with TextDecoderStream present should stream.');
const control = await runStreamText({ simulateExpoReactNative: false });
assert.deepEqual(control.observedErrors, []);
assert.equal(control.output, 'hello world');
console.log('control output:', control.output);

console.log(
  'Reproduction: simulate Expo React Native by removing TextDecoderStream.',
);
const expoLike = await runStreamText({ simulateExpoReactNative: true });

const reportedError = expoLike.observedErrors.find(
  error =>
    error?.name === 'AI_APICallError' &&
    error?.message === 'Failed to process successful response',
);

if (reportedError) {
  console.error(
    'Reproduced issue #13588: streamText emitted the reported APICallError while the local server returned a successful SSE response.',
  );
  throw reportedError;
}

assert.equal(
  expoLike.output,
  'hello world',
  'Expected streamText to deliver the same text in the Expo-like environment.',
);
assert.deepEqual(
  expoLike.observedErrors,
  [],
  'Expected no streamText errors in the Expo-like environment.',
);

console.log('Expo-like output:', expoLike.output);
