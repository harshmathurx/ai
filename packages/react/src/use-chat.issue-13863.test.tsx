import { render, waitFor, cleanup } from '@testing-library/react';
import React, { createContext, useContext, useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ChatTransport, UIMessage } from 'ai';
import { Chat } from './chat.react';
import { useChat } from './use-chat';

describe('issue #13863: shared Chat resume requests', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    cleanup();
  });

  it('only sends one resume-stream request for a shared Chat instance consumed by many useChat hooks', async () => {
    const reconnectCalls: string[] = [];

    const transport: ChatTransport<UIMessage> = {
      sendMessages: async () => {
        throw new Error('sendMessages should not be called by this reproduction');
      },
      reconnectToStream: async ({ chatId }) => {
        reconnectCalls.push(chatId);
        // Simulate the normal no-active-stream response from the resume endpoint.
        return null;
      },
    };

    const SharedChatContext = createContext<Chat<UIMessage> | null>(null);

    function useSharedChatContext() {
      const chat = useContext(SharedChatContext);
      if (chat == null) {
        throw new Error('missing shared chat');
      }
      return { chat };
    }

    function SharedChatProvider({ children }: { children: React.ReactNode }) {
      const [chat] = useState(
        () =>
          new Chat({
            id: 'issue-13863-chat',
            transport,
          }),
      );

      return (
        <SharedChatContext.Provider value={chat}>
          {children}
        </SharedChatContext.Provider>
      );
    }

    function ChatConsumer() {
      const { chat } = useSharedChatContext();
      useChat({ chat, resume: true });
      return null;
    }

    const consumerCount = 20;

    render(
      <SharedChatProvider>
        {Array.from({ length: consumerCount }, (_, index) => (
          <ChatConsumer key={index} />
        ))}
      </SharedChatProvider>,
    );

    await waitFor(() => {
      expect(reconnectCalls.length).toBeGreaterThan(0);
    });

    // Let all mount effects run. Without a fix each useChat({ chat, resume: true })
    // consumer calls chat.resumeStream(), producing one reconnect request per consumer.
    await new Promise(resolve => setTimeout(resolve, 50));

    expect(reconnectCalls).toStrictEqual(['issue-13863-chat']);
  });
});
