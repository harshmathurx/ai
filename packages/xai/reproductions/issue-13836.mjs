#!/usr/bin/env node
import { createXai } from '../dist/index.js';

const prompt = [
  {
    role: 'user',
    content: [
      {
        type: 'text',
        text: 'Reproduce issue #13836: stream a prefix via output_text.delta, then provide final text in response.output_item.done for the same message item.',
      },
    ],
  },
];

const events = [
  {
    type: 'response.created',
    response: {
      id: 'resp_issue_13836',
      object: 'response',
      model: 'grok-4-1-fast-non-reasoning',
      output: [],
      status: 'in_progress',
    },
  },
  {
    type: 'response.output_item.added',
    output_index: 0,
    item: {
      type: 'message',
      id: 'msg_issue_13836',
      role: 'assistant',
      status: 'in_progress',
      content: [],
    },
  },
  {
    type: 'response.output_text.delta',
    item_id: 'msg_issue_13836',
    output_index: 0,
    content_index: 0,
    delta: '1. alfa beta gama\n',
  },
  // xAI Responses can include additional/final text on an output_item.done message.
  // When a text block for this item already exists, current @ai-sdk/xai drops this text.
  {
    type: 'response.output_item.done',
    output_index: 0,
    item: {
      type: 'message',
      id: 'msg_issue_13836',
      role: 'assistant',
      status: 'completed',
      content: [
        {
          type: 'output_text',
          text: '2. delta epsilon zeta\nEND_OK_9981',
          annotations: [],
        },
      ],
    },
  },
  {
    type: 'response.done',
    response: {
      id: 'resp_issue_13836',
      object: 'response',
      model: 'grok-4-1-fast-non-reasoning',
      output: [],
      status: 'completed',
      usage: { input_tokens: 10, output_tokens: 20, total_tokens: 30 },
    },
  },
];

const encoder = new TextEncoder();
const sseBody = events.map(event => `data: ${JSON.stringify(event)}\n\n`).join('') + 'data: [DONE]\n\n';

const fetch = async (url, init) => {
  if (!String(url).endsWith('/responses')) {
    throw new Error(`Unexpected URL: ${url}`);
  }
  if (init?.method !== 'POST') {
    throw new Error(`Unexpected method: ${init?.method}`);
  }

  return new Response(
    new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode(sseBody));
        controller.close();
      },
    }),
    {
      status: 200,
      headers: { 'content-type': 'text/event-stream' },
    },
  );
};

const model = createXai({
  apiKey: 'test-key',
  baseURL: 'https://example.test/v1',
  fetch,
}).responses('grok-4-1-fast-non-reasoning');

const { stream } = await model.doStream({ prompt });
const parts = [];
for await (const part of stream) {
  parts.push(part);
}

const streamedText = parts
  .filter(part => part.type === 'text-delta')
  .map(part => part.delta)
  .join('');
const finish = parts.find(part => part.type === 'finish');

console.log('Stream parts:');
console.log(JSON.stringify(parts, null, 2));
console.log(`\nCombined text (${streamedText.length} chars):`);
console.log(streamedText);
console.log('\nfinish:', JSON.stringify(finish));

if (!streamedText.includes('END_OK_9981')) {
  console.error('\nReproduced issue #13836: final text from response.output_item.done was dropped even though finish reported success.');
  process.exit(1);
}

console.log('\nIssue not reproduced: final marker was present.');
