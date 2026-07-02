import assert from 'node:assert/strict';
import { uiMessageChunkSchema } from '../dist/index.js';
import { safeParseJSON, zodSchema } from '@ai-sdk/provider-utils';
import { z } from 'zod/v4';

function contains(text, needle) {
  assert(
    text.includes(needle),
    `Expected validation error to contain ${JSON.stringify(needle)}.\nActual:\n${text}`,
  );
}

function assertTypeValidationError(result, rejectedKey) {
  assert.equal(
    result.success,
    false,
    `Expected strict schema validation to reject ${rejectedKey}.`,
  );
  assert.equal(result.error.name, 'AI_TypeValidationError');
  contains(result.error.message, rejectedKey);
  contains(result.error.message, 'unrecognized');
}

async function parseChunkWithSchema(schema, chunk) {
  return safeParseJSON({
    text: JSON.stringify(chunk),
    schema,
  });
}

const newerServerChunkWithProviderMetadata = {
  type: 'tool-output-available',
  toolCallId: 'call_13733',
  output: { ok: true },
  providerMetadata: { openai: { itemId: 'item_13733' } },
};

// This represents the cached client schema from ai@6.0.119 and earlier for the
// concrete regression reported in #13733: providerMetadata did not exist on this
// chunk yet, and strictObject rejects it after the server is upgraded.
const cachedClientToolOutputSchemaBeforeProviderMetadata = zodSchema(
  z.union([
    z.strictObject({
      type: z.literal('tool-output-available'),
      toolCallId: z.string(),
      output: z.unknown(),
    }),
  ]),
);

const originalRegressionResult = await parseChunkWithSchema(
  cachedClientToolOutputSchemaBeforeProviderMetadata,
  newerServerChunkWithProviderMetadata,
);

assertTypeValidationError(originalRegressionResult, 'providerMetadata');

console.log(
  'Reproduced original #13733 shape: a strict cached tool-output-available schema rejects providerMetadata.',
);

// The current checkout already knows about providerMetadata/toolMetadata, so use
// a future optional server-added field to verify the same forward-compatibility
// bug remains in the real exported uiMessageChunkSchema in this worktree.
const futureServerChunk = {
  ...newerServerChunkWithProviderMetadata,
  futureOptionalField: { addedInLaterServer: true },
};

const currentSchemaResult = await parseChunkWithSchema(
  uiMessageChunkSchema,
  futureServerChunk,
);

assertTypeValidationError(currentSchemaResult, 'futureOptionalField');

console.log(
  'Reproduced current root cause: exported uiMessageChunkSchema still rejects unknown optional fields.',
);

assert.fail(
  [
    'Forward-compatibility expectation failed.',
    'uiMessageChunkSchema should accept and ignore/pass through unknown optional stream chunk fields,',
    `but it threw ${currentSchemaResult.error.name} with an unrecognized_keys validation issue for "futureOptionalField".`,
  ].join(' '),
);
