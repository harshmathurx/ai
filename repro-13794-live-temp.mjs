import { streamText, tool, isStepCount, jsonSchema } from './packages/ai/dist/index.js';
import { anthropic, forwardAnthropicContainerIdFromLastStep } from './packages/anthropic/dist/index.js';

const modelId = process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-5-20250929';
let rollCount=0;
const result = streamText({
  model: anthropic(modelId),
  tools: {
    code_execution: anthropic.tools.codeExecution_20260120(),
    rollDie: tool({
      description: 'Roll a six-sided die for a player. Player 2 has a loaded die and usually rolls high.',
      inputSchema: jsonSchema({ type: 'object', properties: { player: { type: 'string', enum: ['player1','player2'] } }, required: ['player'], additionalProperties: false }),
      execute: async ({ player }) => {
        rollCount++;
        const v = player === 'player2' ? 6 : 2 + (rollCount % 4);
        console.log('rollDie executed', player, v);
        return v;
      },
      providerOptions: {
        anthropic: { allowedCallers: ['code_execution_20260120'] },
      },
    }),
  },
  prompt: `Use code_execution to run a short simulation of a dice game between player1 and player2. The code MUST call the provided rollDie tool for each player's roll, for two rounds, then print the winner. After the code finishes, summarize the result in one sentence.`,
  stopWhen: isStepCount(10),
  prepareStep: forwardAnthropicContainerIdFromLastStep,
  onError({ error }) { console.error('onError', error?.message || error); },
});
let seenError=false;
for await (const part of result.fullStream) {
  if (part.type === 'error') { seenError=true; console.log('PART error', part.error?.message || part.error); }
  else if (['start-step','finish-step','tool-call','tool-result','text-delta','finish'].includes(part.type)) {
    console.log('PART', part.type, part.type==='text-delta' ? (part.text ?? part.delta ?? '') : '');
  }
}
console.log('seenError', seenError);
console.log('steps', (await result.steps).length);
console.log('text', JSON.stringify(await result.text));
console.log('lastResponseRole', (await result.responseMessages).at(-1)?.role);
