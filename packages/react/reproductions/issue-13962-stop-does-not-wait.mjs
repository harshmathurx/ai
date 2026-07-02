import assert from 'node:assert/strict';
import { Chat } from '@ai-sdk/react';

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

async function waitFor(predicate, description, timeoutMs = 1000) {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) {
      throw new Error(`Timed out waiting for ${description}`);
    }
    await sleep(1);
  }
}

let streamController;
let abortSignalFired = false;
let finishEvent;
let finishResolve;
const finishPromise = new Promise(resolve => {
  finishResolve = resolve;
});

const stream = new ReadableStream({
  start(controller) {
    streamController = controller;
    controller.enqueue({ type: 'start' });
    controller.enqueue({ type: 'start-step' });
    controller.enqueue({ type: 'text-start', id: 'text-1' });
    controller.enqueue({ type: 'text-delta', id: 'text-1', delta: 'Hello' });
  },
});

const chat = new Chat({
  id: 'issue-13962',
  generateId: (() => {
    let id = 0;
    return () => `id-${id++}`;
  })(),
  transport: {
    async sendMessages({ abortSignal }) {
      abortSignal.addEventListener('abort', () => {
        abortSignalFired = true;

        // Simulate a chunk that was already buffered in the stream pipeline when
        // abort was requested. This is the race apps hit when they call
        // await chat.stop(); chat.messages = [] during a clear-chat flow.
        setTimeout(() => {
          streamController.enqueue({
            type: 'text-delta',
            id: 'text-1',
            delta: ' AFTER_STOP',
          });
        }, 0);

        // Only after the buffered chunk is delivered does the stream notice the
        // abort and terminate.
        setTimeout(() => {
          streamController.error(new DOMException('Aborted', 'AbortError'));
        }, 25);
      });

      return stream;
    },
    async reconnectToStream() {
      throw new Error('not used');
    },
  },
  onFinish(event) {
    finishEvent = event;
    finishResolve(event);
  },
});

const sendPromise = chat.sendMessage({ text: 'Hello, world!' });

await waitFor(
  () =>
    chat.status === 'streaming' &&
    chat.messages.some(message =>
      message.parts?.some(part => part.type === 'text' && part.text === 'Hello'),
    ),
  'initial streamed text',
);

await chat.stop();

assert.equal(abortSignalFired, true, 'chat.stop() should abort the transport');
assert.equal(
  chat.status,
  'streaming',
  'BUG: await chat.stop() returned before the stream pipeline set status back to ready',
);

chat.messages = [];

await waitFor(
  () =>
    chat.messages.some(message =>
      message.parts?.some(
        part => part.type === 'text' && part.text.includes('AFTER_STOP'),
      ),
    ),
  'a buffered stream chunk to update messages after clearing them',
);

await finishPromise;
await sendPromise;

assert.equal(finishEvent.isAbort, true, 'final onFinish should report an abort');

console.log(
  JSON.stringify(
    {
      reproduced: true,
      statusImmediatelyAfterAwaitStop: 'streaming',
      messagesAfterClearWereRepopulated: chat.messages,
      finalStatus: chat.status,
      finishIsAbort: finishEvent.isAbort,
    },
    null,
    2,
  ),
);
