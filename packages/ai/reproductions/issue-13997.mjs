#!/usr/bin/env node
/*
 Reproduction for vercel/ai#13997.

 Scenario: an assistant response message returned by generateText() contains a
 reasoning part with provider metadata that is copied to `providerOptions` in
 `result.response.messages`. Persisting that message and later passing it back
 as `messages` fails ModelMessage validation, while manually stripping
 `providerOptions` lets the same history through.

 Run from the repository root after packages are built:
   node packages/ai/reproductions/issue-13997.mjs

 The script exits with code 1 when the current bug is reproduced.
*/
import assert from 'node:assert/strict';
import { generateText } from '../dist/index.js';
import { MockLanguageModelV4 } from '../dist/test/index.js';

const usage = {
  inputTokens: { total: 1, noCache: 1 },
  outputTokens: { total: 1, text: 1 },
};

const responseWithReasoningMetadata = new MockLanguageModelV4({
  provider: 'openrouter-repro',
  modelId: 'google/gemini-3-flash-preview',
  doGenerate: {
    finishReason: { unified: 'stop', raw: 'stop' },
    usage,
    warnings: [],
    content: [
      {
        type: 'reasoning',
        text: 'model reasoning trace',
        // This intentionally mirrors the reported round-trip problem: core
        // copies providerMetadata to response.messages[].content[].providerOptions,
        // but ModelMessage validation requires providerOptions to be nested by
        // provider name (Record<string, Record<string, JSONValue>>). A top-level
        // reasoning_details array is therefore emitted but cannot be loaded back.
        providerMetadata: {
          reasoning_details: [
            { type: 'reasoning.encrypted', data: 'encrypted-reasoning-token' },
          ],
        },
      },
      { type: 'text', text: 'hello' },
    ],
  },
});

const initialHistory = [{ role: 'user', content: 'hello' }];
const first = await generateText({
  model: responseWithReasoningMetadata,
  messages: initialHistory,
});

const persistedHistory = JSON.parse(
  JSON.stringify([...initialHistory, ...first.response.messages]),
);

console.log('Persisted response.messages:');
console.log(JSON.stringify(first.response.messages, null, 2));

assert.equal(
  persistedHistory[1].content[0].providerOptions.reasoning_details[0].data,
  'encrypted-reasoning-token',
  'setup failed: response message did not contain the expected providerOptions reasoning details',
);

const followupModel = new MockLanguageModelV4({
  doGenerate: {
    finishReason: { unified: 'stop', raw: 'stop' },
    usage,
    warnings: [],
    content: [{ type: 'text', text: 'follow-up' }],
  },
});

try {
  await generateText({
    model: followupModel,
    messages: persistedHistory,
  });

  console.log('BUG NOT REPRODUCED: persisted history was accepted.');
  process.exit(0);
} catch (error) {
  console.error('\nReproduced issue #13997: persisted ModelMessage[] was rejected.');
  console.error(`${error.name}: ${error.message}`);
  if (!/ModelMessage\[\] schema/.test(error.message)) {
    throw error;
  }

  const strippedHistory = JSON.parse(JSON.stringify(persistedHistory));
  delete strippedHistory[1].content[0].providerOptions;
  await generateText({ model: followupModel, messages: strippedHistory });
  console.error(
    'Confirmed workaround: deleting providerOptions from the persisted reasoning part makes the same history validate.',
  );

  // Exit non-zero so this artifact demonstrates the current failure directly.
  process.exit(1);
}
