import { anthropic } from '@ai-sdk/anthropic';
import { convertToModelMessages, generateText, tool } from 'ai';
import { z } from 'zod';

const rawInput = '{"to": John Doe <john@example.com>, "subject":"Hello"}';

const uiMessages = [
  {
    role: 'user',
    parts: [{ type: 'text', text: 'Send an email to John Doe.' }],
  },
  {
    role: 'assistant',
    parts: [
      {
        type: 'tool-sendEmail',
        toolCallId: 'toolu_01Issue13645BadInput',
        state: 'output-error',
        input: undefined,
        rawInput,
        errorText: 'Tool input JSON parse error',
      },
    ],
  },
  {
    role: 'user',
    parts: [{ type: 'text', text: 'Please retry.' }],
  },
];

const tools = {
  sendEmail: tool({
    description: 'Send an email.',
    inputSchema: z.object({
      to: z.string(),
      subject: z.string().optional(),
    }),
  }),
};

const messages = await convertToModelMessages(uiMessages);
const badToolCall = messages
  .find(message => message.role === 'assistant')
  ?.content.find(part => part.type === 'tool-call');

console.log('Converted assistant tool-call:', JSON.stringify(badToolCall));

if (typeof badToolCall?.input !== 'string') {
  throw new Error(
    `Could not reproduce local conversion bug: expected tool-call input to be a raw string, got ${typeof badToolCall?.input}`,
  );
}

if (!process.env.ANTHROPIC_API_KEY) {
  throw new Error(
    'ANTHROPIC_API_KEY is required to run the live Anthropic validation step.',
  );
}

const modelId = process.env.ANTHROPIC_MODEL ?? 'claude-haiku-4-5';

try {
  await generateText({
    model: anthropic(modelId),
    messages,
    tools,
    maxRetries: 0,
    maxOutputTokens: 16,
  });
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error('Live Anthropic error:', message);

  if (
    message.includes('Input should be a valid dictionary') ||
    message.includes('tool_use.input')
  ) {
    throw new Error(
      `Reproduced issue #13645: convertToModelMessages emitted rawInput as a string, and Anthropic rejected tool_use.input. Original error: ${message}`,
    );
  }

  throw error;
}

throw new Error(
  'Anthropic accepted the malformed tool_use.input string; issue #13645 was not reproduced.',
);
