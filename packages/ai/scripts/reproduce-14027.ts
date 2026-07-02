import {
  createStreamingUIMessageState,
  processUIMessageStream,
  type StreamingUIMessageState,
} from '../src/ui/process-ui-message-stream';
import type { UIMessageChunk } from '../src/ui-message-stream/ui-message-chunks';
import type { UIMessage } from '../src/ui/ui-messages';

function streamFromChunks(chunks: UIMessageChunk[]) {
  return new ReadableStream<UIMessageChunk>({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(chunk);
      }
      controller.close();
    },
  });
}

async function drain(stream: ReadableStream<unknown>) {
  const reader = stream.getReader();
  while (true) {
    const { done } = await reader.read();
    if (done) break;
  }
}

const lastMessage: UIMessage = {
  id: 'assistant-message-with-partial-static-tool',
  role: 'assistant',
  parts: [
    {
      type: 'tool-create_document',
      toolCallId: 'tool-call-14027',
      state: 'input-streaming',
      input: { title: 'par' },
    } as any,
  ],
};

let state: StreamingUIMessageState<UIMessage> = createStreamingUIMessageState({
  lastMessage,
  messageId: 'new-message-id-should-not-be-used',
});

const resumedChunks: UIMessageChunk[] = [
  // This simulates reconnecting after the persisted assistant message already
  // contains the input-streaming static tool part above. The resumed stream
  // continues with the next input delta for the same tool call.
  {
    type: 'tool-input-delta',
    toolCallId: 'tool-call-14027',
    inputTextDelta: 'tial"}',
  },
];

const output = processUIMessageStream({
  stream: streamFromChunks(resumedChunks),
  runUpdateMessageJob: async job =>
    job({
      state,
      write: () => {
        // keep the current in-memory state; this mirrors Chat's serialized
        // update path but avoids depending on framework code.
      },
    }),
  onError: error => {
    throw error;
  },
});

try {
  await drain(output);

  const toolPart = state.message.parts.find(
    part =>
      part.type === 'tool-create_document' &&
      (part as any).toolCallId === 'tool-call-14027',
  ) as any;

  if (toolPart?.state !== 'input-streaming') {
    throw new Error(`Expected tool part to remain input-streaming.`);
  }

  if (toolPart.input?.title !== 'partial') {
    throw new Error(
      `Expected resumed delta to update static tool input to {"title":"partial"}, got ${JSON.stringify(
        toolPart.input,
      )}.`,
    );
  }

  console.log('Issue #14027 scenario succeeded; no resume crash observed.');
} catch (error) {
  console.error('Issue #14027 reproduction failed while resuming a partial static tool call.');
  console.error(error);
  process.exitCode = 1;
}
