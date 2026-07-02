#!/usr/bin/env node

/**
 * Reproduction for vercel/ai#14009.
 *
 * Azure AI Foundry project endpoints already include the OpenAI prefix:
 *
 *   https://<resource>.services.ai.azure.com/api/projects/<project>/openai
 *
 * For Foundry project /openai/v1/* endpoints the issue reports that the
 * provider should not append an api-version query parameter. This script
 * uses the real @ai-sdk/azure provider URL construction and a fetch
 * interceptor that aborts after recording the outgoing request URL.
 *
 * Run from the repository root:
 *
 *   node packages/azure/reproductions/issue-14009-foundry-project-api-version.mjs
 *
 * Current failing behavior:
 *
 *   .../api/projects/<project>/openai/v1/responses?api-version=v1
 */

import { strict as assert } from 'node:assert';
import { createAzure } from '../dist/index.js';

const capturedRequests = [];

const provider = createAzure({
  baseURL:
    'https://test-resource.services.ai.azure.com/api/projects/test-project/openai',
  apiKey: 'test-api-key',
  fetch: async (input, init) => {
    capturedRequests.push({
      url: String(input),
      method: init?.method,
    });

    // The bug is in URL construction. Abort before any network call.
    throw new Error('reproduction: abort after capturing request URL');
  },
});

try {
  await provider.responses('gpt-4.1').doStream({
    prompt: [{ role: 'user', content: [{ type: 'text', text: 'Hello' }] }],
  });
} catch (error) {
  if (
    !(error instanceof Error) ||
    !error.message.includes('abort after capturing request URL')
  ) {
    throw error;
  }
}

assert.equal(
  capturedRequests.length,
  1,
  `expected exactly one captured request, got ${capturedRequests.length}`,
);

const requestUrl = new URL(capturedRequests[0].url);

console.log(`Captured Azure Foundry Responses request: ${requestUrl}`);

assert.equal(
  requestUrl.origin + requestUrl.pathname,
  'https://test-resource.services.ai.azure.com/api/projects/test-project/openai/v1/responses',
);

assert.equal(
  requestUrl.searchParams.has('api-version'),
  false,
  `Expected no api-version query for Foundry project /openai/v1/* endpoints, but captured ${requestUrl}`,
);

console.log('PASS: Foundry project /openai/v1/* request omitted api-version.');
