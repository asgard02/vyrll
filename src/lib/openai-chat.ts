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

export type OpenAIUsageStep = "copy" | "subtitles" | "chapters" | "chat" | "library";

export function openAIUsageCounts(data: unknown): { prompt: number; completion: number } {
  if (!data || typeof data !== "object") return { prompt: 0, completion: 0 };
  const usage = (data as { usage?: unknown }).usage;
  if (!usage || typeof usage !== "object") return { prompt: 0, completion: 0 };
  const rec = usage as Record<string, unknown>;
  const prompt = Number(rec.prompt_tokens ?? rec.input_tokens ?? 0);
  const completion = Number(rec.completion_tokens ?? rec.output_tokens ?? 0);
  return {
    prompt: Number.isFinite(prompt) ? prompt : 0,
    completion: Number.isFinite(completion) ? completion : 0,
  };
}

export function logOpenAIUsage(info: {
  jobId?: string | null;
  step: OpenAIUsageStep;
  model: string;
  promptTokens: number;
  completionTokens: number;
  retry: number;
}): void {
  const job = info.jobId?.trim() || "-";
  const prompt = Number.isFinite(info.promptTokens) ? info.promptTokens : 0;
  const completion = Number.isFinite(info.completionTokens) ? info.completionTokens : 0;
  const retry = Number.isFinite(info.retry) ? info.retry : 0;
  console.log(
    `[openai-usage] job=${job} step=${info.step} model=${info.model} prompt_tokens=${prompt} completion_tokens=${completion} retry=${retry}`
  );
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
