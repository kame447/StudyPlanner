import type { JsonSchemaResponseFormat } from '../../../services/ai/openAiCompatibleClient';

/** One action per renderer invocation. The alias is scoped to this request, never persisted
 * as application identity or accepted as a lifecycle command. Preserve original provider
 * bytes by validating the reply against the bound input, not rewriting its JSON afterwards. */
export function bindWeeklyPlanningDialogueActionToken<T extends { actionId: string }>(
  input: T,
  responseFormat: JsonSchemaResponseFormat,
): { input: T; responseFormat: JsonSchemaResponseFormat; actionBinding: { token: string; actionId: string } } {
  const token = 'a1';
  return {
    input: { ...input, actionId: token },
    actionBinding: { token, actionId: input.actionId },
    responseFormat: {
      ...responseFormat,
      json_schema: {
        ...responseFormat.json_schema,
        schema: {
          ...responseFormat.json_schema.schema,
          properties: {
            ...(responseFormat.json_schema.schema.properties as Record<string, unknown>),
            actionId: { type: 'string', enum: [token] },
          },
        },
      },
    },
  };
}
