#!/usr/bin/env node
import assert from 'node:assert/strict';
import { lastAssistantMessageIsCompleteWithApprovalResponses } from '../../packages/ai/dist/index.js';

// Reproduction for https://github.com/vercel/ai/issues/13670
//
// `output-denied` is a terminal tool state produced for a denied approval.
// When the last assistant step includes an approval response and all tool
// invocations are otherwise terminal, sendAutomaticallyWhen should unblock.
const messages = [
  {
    id: 'user-1',
    role: 'user',
    parts: [{ type: 'text', text: 'Use the tools.' }],
  },
  {
    id: 'assistant-1',
    role: 'assistant',
    parts: [
      { type: 'step-start' },
      {
        type: 'tool-approvedTool',
        toolCallId: 'call-approved',
        state: 'approval-responded',
        input: { value: 'approved' },
        approval: { id: 'approval-approved', approved: true },
      },
      {
        type: 'tool-deniedTool',
        toolCallId: 'call-denied',
        state: 'output-denied',
        input: { value: 'denied' },
        approval: {
          id: 'approval-denied',
          approved: false,
          reason: 'User denied approval',
        },
      },
    ],
  },
];

const actual = lastAssistantMessageIsCompleteWithApprovalResponses({
  messages,
});

console.log(
  `lastAssistantMessageIsCompleteWithApprovalResponses returned ${actual} for a last assistant step containing approval-responded + output-denied terminal tool parts.`,
);

assert.equal(
  actual,
  true,
  '`output-denied` should be treated as terminal so automatic sending can continue after a denied approval.',
);
