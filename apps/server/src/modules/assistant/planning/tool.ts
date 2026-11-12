import { z } from 'zod';

import type { ToolSpec } from '../model/language-model.js';
import type { ActionAnswer, PlanningPorts } from './actions.js';
import type { Turn } from './state.js';

/**
 * A tool the model may ask for. It validates its arguments with its own schema; a call that does
 * not fit is rejected and reported back to the model, never adapted.
 */
export interface AssistantTool {
  readonly spec: ToolSpec;
  readonly run: (args: unknown, ports: PlanningPorts, turn: Turn) => Promise<ToolOutcome>;
}

type ToolOutcome =
  | { readonly ok: true; readonly answer: ActionAnswer }
  | { readonly ok: false; readonly issues: readonly string[] };

export function defineTool<S extends z.ZodType>(
  name: string,
  description: string,
  input: S,
  run: (input: z.infer<S>, ports: PlanningPorts, turn: Turn) => Promise<ActionAnswer>,
): AssistantTool {
  const { $schema, ...parameters } = z.toJSONSchema(input);
  return {
    spec: { name, description, parameters },
    run: async (args, ports, turn) => {
      const parsed = input.safeParse(args);
      if (!parsed.success) {
        return {
          ok: false,
          issues: parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`),
        };
      }
      return { ok: true, answer: await run(parsed.data, ports, turn) };
    },
  };
}
