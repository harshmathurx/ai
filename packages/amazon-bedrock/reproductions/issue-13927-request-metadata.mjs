import assert from 'node:assert/strict';
import { createAmazonBedrock } from '../dist/index.js';

const prompt = [
  {
    role: 'user',
    content: [{ type: 'text', text: 'Hello' }],
  },
];

const successfulGenerateBody = {
  output: {
    message: {
      role: 'assistant',
      content: [{ text: 'Hello from Bedrock' }],
    },
  },
  usage: {
    inputTokens: 1,
    outputTokens: 3,
    totalTokens: 4,
  },
  stopReason: 'end_turn',
};

const fetchCalls = [];

const bedrock = createAmazonBedrock({
  region: 'us-east-1',
  // Use Bedrock bearer-token mode so this reproduction does not require AWS
  // credentials. The fetch below deterministically returns successful Bedrock-
  // shaped responses; the bug is that the provider drops the already-built
  // request body from the doGenerate/doStream result objects.
  apiKey: 'dummy-local-reproduction-token',
  fetch: async (url, init) => {
    fetchCalls.push({
      url: String(url),
      body: init?.body,
    });

    if (String(url).endsWith('/converse-stream')) {
      return new Response(
        new ReadableStream({
          start(controller) {
            controller.close();
          },
        }),
        {
          status: 200,
          headers: {
            'content-type': 'application/vnd.amazon.eventstream',
            'x-amzn-requestid': 'issue-13927-stream',
          },
        },
      );
    }

    return new Response(JSON.stringify(successfulGenerateBody), {
      status: 200,
      headers: {
        'content-type': 'application/json',
        'x-amzn-requestid': 'issue-13927-generate',
      },
    });
  },
});

const model = bedrock('anthropic.claude-3-haiku-20240307-v1:0');

const generateResult = await model.doGenerate({ prompt });
const streamResult = await model.doStream({ prompt });

const observed = {
  doGenerateRequest: generateResult.request,
  doStreamRequest: streamResult.request,
  fetchRequestBodies: fetchCalls.map(call => JSON.parse(call.body)),
};

console.log(JSON.stringify(observed, null, 2));

const failures = [];

try {
  assert.ok(
    generateResult.request?.body,
    'doGenerate() should return request.body, but result.request is undefined',
  );
} catch (error) {
  failures.push(error);
}

try {
  assert.ok(
    streamResult.request?.body,
    'doStream() should return request.body, but result.request is undefined',
  );
} catch (error) {
  failures.push(error);
}

if (failures.length > 0) {
  throw new AggregateError(
    failures,
    'vercel/ai issue #13927 reproduced: @ai-sdk/amazon-bedrock omits request.body from doGenerate() and/or doStream() results',
  );
}

