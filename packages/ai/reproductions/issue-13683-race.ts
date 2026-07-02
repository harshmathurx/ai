import { jsonSchema, streamText, tool } from '../dist/index.js';
import {
  MockLanguageModelV4,
  convertArrayToReadableStream,
} from '../dist/test/index.js';

const usage = {
  inputTokens: {
    total: 3,
    noCache: 3,
    cacheRead: undefined,
    cacheWrite: undefined,
  },
  outputTokens: {
    total: 10,
    text: 10,
    reasoning: undefined,
  },
};

const toolCallCount = 25;
const iterations = 25;

const errors: unknown[] = [];

process.on('uncaughtException', error => {
  errors.push(error);
});

process.on('unhandledRejection', reason => {
  errors.push(reason);
});

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(r => {
    resolve = r;
  });
  return { promise, resolve };
}

async function runConcurrentToolCompletionIteration(iteration: number) {
  const releaseTools = deferred();
  let startedTools = 0;

  const model = new MockLanguageModelV4({
    doStream: async () => ({
      stream: convertArrayToReadableStream([
        ...Array.from({ length: toolCallCount }, (_, index) => ({
          type: 'tool-call' as const,
          toolCallId: `call-${iteration}-${index}`,
          toolName: 'testTool',
          input: JSON.stringify({ value: `${iteration}:${index}` }),
        })),
        {
          type: 'finish' as const,
          finishReason: { unified: 'tool-calls' as const, raw: 'tool-calls' },
          usage,
        },
      ]),
    }),
  });

  const result = streamText({
    model,
    tools: {
      testTool: tool({
        inputSchema: jsonSchema<{
          value: string;
        }>({
          type: 'object',
          properties: { value: { type: 'string' } },
          required: ['value'],
          additionalProperties: false,
        }),
        execute: async ({ value }) => {
          startedTools++;
          if (startedTools === toolCallCount) {
            queueMicrotask(releaseTools.resolve);
          }
          await releaseTools.promise;
          return `result:${value}`;
        },
      }),
    },
    prompt: 'trigger many concurrent tool calls',
  });

  const parts = [];
  for await (const part of result.stream) {
    parts.push(part);
  }

  const toolResults = parts.filter(part => part.type === 'tool-result');
  if (toolResults.length !== toolCallCount) {
    throw new Error(
      `iteration ${iteration}: expected ${toolCallCount} tool results, got ${toolResults.length}`,
    );
  }
}

async function runCancelWhileToolPendingScenario() {
  const releaseTool = deferred();

  const model = new MockLanguageModelV4({
    doStream: async () => ({
      stream: convertArrayToReadableStream([
        {
          type: 'tool-call' as const,
          toolCallId: 'cancel-call',
          toolName: 'testTool',
          input: JSON.stringify({ value: 'cancel' }),
        },
        {
          type: 'finish' as const,
          finishReason: { unified: 'tool-calls' as const, raw: 'tool-calls' },
          usage,
        },
      ]),
    }),
  });

  const result = streamText({
    model,
    tools: {
      testTool: tool({
        inputSchema: jsonSchema<{
          value: string;
        }>({
          type: 'object',
          properties: { value: { type: 'string' } },
          required: ['value'],
          additionalProperties: false,
        }),
        execute: async ({ value }) => {
          await releaseTool.promise;
          return `result:${value}`;
        },
      }),
    },
    prompt: 'trigger then cancel',
  });

  const reader = result.toUIMessageStream().getReader();

  await reader.read();
  await reader.cancel('issue-13683 reproduction cancellation');
  releaseTool.resolve();

  // Give any late enqueue/close attempts a chance to surface as an unhandled
  // rejection or uncaught exception.
  await new Promise(resolve => setTimeout(resolve, 50));
}

for (let iteration = 0; iteration < iterations; iteration++) {
  await runConcurrentToolCompletionIteration(iteration);
}

await runCancelWhileToolPendingScenario();

if (errors.length > 0) {
  throw new Error(
    `Observed asynchronous stream controller error(s): ${errors
      .map(error => (error instanceof Error ? error.stack : String(error)))
      .join('\n---\n')}`,
  );
}

console.log(
  `issue-13683 harness completed: ${iterations} concurrent runs with ${toolCallCount} tools each, plus cancellation scenario, without stream-controller enqueue/close errors.`,
);
