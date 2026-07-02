#!/usr/bin/env node
/**
 * Reproduction harness for vercel/ai#13794.
 *
 * This intentionally calls the live Anthropic Messages API (no mocks). It uses
 * Sonnet 4.x, the Anthropic code_execution provider tool with deferred results,
 * and a client tool that code_execution is allowed to call. A fetch wrapper logs
 * the roles in every outbound Anthropic request and fails if the SDK schedules
 * the spurious continuation described in the issue (a request whose final
 * message role is "assistant", which Anthropic rejects as assistant prefill).
 *
 * Usage:
 *   ANTHROPIC_API_KEY=... node reproductions/issue-13794-anthropic-code-execution.mjs
 *
 * Optional:
 *   ANTHROPIC_MODEL=claude-sonnet-4-6 node reproductions/issue-13794-anthropic-code-execution.mjs
 */
import assert from 'node:assert/strict';
import {
  isStepCount,
  jsonSchema,
  streamText,
  tool,
} from '../packages/ai/dist/index.js';
import {
  createAnthropic,
  forwardAnthropicContainerIdFromLastStep,
} from '../packages/anthropic/dist/index.js';

if (!process.env.ANTHROPIC_API_KEY) {
  throw new Error('ANTHROPIC_API_KEY is required for this live reproduction.');
}

const modelId = process.env.ANTHROPIC_MODEL ?? 'claude-sonnet-4-6';
const requests = [];

const anthropic = createAnthropic({
  fetch: async (url, init) => {
    if (typeof init?.body === 'string') {
      const body = JSON.parse(init.body);
      if (Array.isArray(body.messages)) {
        const roles = body.messages.map(message => message.role);
        requests.push({
          url: String(url),
          roles,
          lastRole: roles.at(-1),
        });
        console.log(
          `[anthropic request ${requests.length}] roles=${roles.join('>')}`,
        );
      }
    }

    return fetch(url, init);
  },
});

let rollCount = 0;
const result = streamText({
  model: anthropic(modelId),
  tools: {
    code_execution: anthropic.tools.codeExecution_20260120(),
    rollDie: tool({
      description:
        'Roll a six-sided die for a player. Player 2 has a loaded die and always rolls high.',
      inputSchema: jsonSchema({
        type: 'object',
        properties: {
          player: { type: 'string', enum: ['player1', 'player2'] },
        },
        required: ['player'],
        additionalProperties: false,
      }),
      execute: async ({ player }) => {
        rollCount++;
        const value = player === 'player2' ? 6 : 2 + (rollCount % 4);
        console.log(`[rollDie] ${player} -> ${value}`);
        return value;
      },
      providerOptions: {
        anthropic: {
          allowedCallers: ['code_execution_20260120'],
        },
      },
    }),
  },
  prompt:
    'Use code_execution to run a two-round dice game between player1 and player2. ' +
    "The code MUST call the provided rollDie tool for each player's roll, print the winner, " +
    'and then you must summarize the result in one sentence.',
  stopWhen: isStepCount(10),
  prepareStep: forwardAnthropicContainerIdFromLastStep,
  onError({ error }) {
    console.error('[stream onError]', error);
  },
});

const errorMessages = [];
const textDeltas = [];

for await (const part of result.fullStream) {
  switch (part.type) {
    case 'error':
      errorMessages.push(String(part.error?.message ?? part.error));
      console.log(`[stream error] ${errorMessages.at(-1)}`);
      break;
    case 'text-delta':
      textDeltas.push(part.text ?? part.delta ?? '');
      break;
    case 'tool-call':
      console.log(`[tool-call] ${part.toolName} ${part.toolCallId}`);
      break;
    case 'tool-result':
      console.log(`[tool-result] ${part.toolName} ${part.toolCallId}`);
      break;
  }
}

const steps = await result.steps;
const toolCalls = await result.toolCalls;
const responseMessages = await result.responseMessages;
const assistantLastRequests = requests.filter(
  request => request.lastRole === 'assistant',
);

console.log(`model=${modelId}`);
console.log(`steps=${steps.length}`);
console.log(`requests=${requests.length}`);
console.log(`finalText=${JSON.stringify(await result.text)}`);
console.log(`finalResponseRole=${responseMessages.at(-1)?.role}`);

assert.equal(
  errorMessages.length,
  0,
  `Expected no stream error parts, saw: ${errorMessages.join(' | ')}`,
);
assert.equal(
  assistantLastRequests.length,
  0,
  `SDK sent Anthropic request(s) ending in assistant: ${JSON.stringify(
    assistantLastRequests,
  )}`,
);
assert.ok(
  toolCalls.some(toolCall => toolCall.toolName === 'code_execution'),
  'Expected the model to call the Anthropic code_execution provider tool.',
);
assert.ok(
  requests.length > 1,
  'Expected multiple Anthropic requests to exercise deferred continuation.',
);
assert.ok(textDeltas.join('').length > 0, 'Expected final assistant text.');

console.log('issue-13794 reproduction did not observe the reported failure.');
