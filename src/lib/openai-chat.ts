/**
 * Corps Chat Completions partagé par le chat support et la Library.
 * gpt-6 : reasoning_effort "none" pour que temperature reste acceptée.
 * gpt-4o-mini : pas de reasoning_effort (retour arrière via SUPPORT_CHAT_MODEL).
 * max_completion_tokens pour tous les modèles. Jamais max_tokens.
 */

export const DEFAULT_SUPPORT_CHAT_MODEL = "gpt-6-luna";

export function supportChatModel(): string {
  return process.env.SUPPORT_CHAT_MODEL?.trim() || DEFAULT_SUPPORT_CHAT_MODEL;
}

export function buildOpenAIChatBody(opts: {
  model?: string;
  temperature: number;
  maxCompletionTokens: number;
  messages: unknown[];
  stream?: boolean;
  responseFormat?: { type: "json_object" };
}): Record<string, unknown> {
  const model = (opts.model ?? supportChatModel()).trim() || DEFAULT_SUPPORT_CHAT_MODEL;
  const body: Record<string, unknown> = {
    model,
    temperature: opts.temperature,
    max_completion_tokens: opts.maxCompletionTokens,
    messages: opts.messages,
  };
  if (model.startsWith("gpt-6")) {
    body.reasoning_effort = "none";
  }
  if (opts.stream) body.stream = true;
  if (opts.responseFormat) body.response_format = opts.responseFormat;
  return body;
}
