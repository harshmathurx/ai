import assert from 'node:assert/strict';
import { z } from '../packages/ai/node_modules/zod/v4/index.js';
import { validateUIMessages } from '../packages/ai/src';

const inputSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('create'),
    payload: z.object({
      title: z.string(),
      count: z.number().int(),
    }),
  }),
  z.object({
    kind: z.literal('delete'),
    id: z.string().uuid(),
  }),
]);

const invalidPersistedInput = JSON.stringify({
  kind: 'create',
  payload: { title: 'not an object at the top level', count: 1 },
});

const toolDefinition = {
  inputSchema,
};

const historicalAssistantMessage = {
  id: 'assistant-1',
  role: 'assistant' as const,
  parts: [
    {
      type: 'tool-complexTool' as const,
      toolCallId: 'tool-call-1',
      state: 'output-error' as const,
      input: invalidPersistedInput,
      errorText: 'AI_InvalidToolInputError: expected object, received string',
    },
  ],
};

const nextUserMessage = {
  id: 'user-2',
  role: 'user' as const,
  parts: [{ type: 'text' as const, text: 'next turn after the handled tool error' }],
};

assert.equal(
  inputSchema.safeParse(invalidPersistedInput).success,
  false,
  'reproduction setup must contain input that fails the tool schema',
);

async function main() {
  await assert.rejects(
    validateUIMessages({
      messages: [
        {
          ...historicalAssistantMessage,
          parts: [
            {
              ...historicalAssistantMessage.parts[0],
              state: 'output-available' as const,
              output: 'irrelevant output',
            },
          ],
        },
      ],
      tools: { complexTool: toolDefinition },
    }),
    /Type validation failed/,
    'invalid input should still be validated for output-available tool parts',
  );

  const validatedMessages = await validateUIMessages({
    messages: [historicalAssistantMessage, nextUserMessage],
    tools: { complexTool: toolDefinition },
  });

  assert.equal(validatedMessages.length, 2);
  assert.deepEqual(validatedMessages[0], historicalAssistantMessage);
  assert.deepEqual(validatedMessages[1], nextUserMessage);

  console.log(
    'issue-13591 scenario did not reproduce: validateUIMessages accepted an historical output-error tool part with invalid persisted input on the next turn.',
  );
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
