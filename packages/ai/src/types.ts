export interface Usage {
  inputTokens: number;
  outputTokens: number;
}

export interface ToolDef {
  name: string;
  description: string;
  /** JSON Schema (object) for the tool input. */
  inputSchema: Record<string, unknown>;
}

export interface ToolCall {
  id: string;
  name: string;
  input: Record<string, unknown>;
}

export interface ToolResult {
  id: string;
  content: string;
  isError?: boolean;
}

export interface ImageInput {
  mimeType: string;
  base64: string;
}

export interface TurnResult {
  text: string;
  toolCalls: ToolCall[];
  usage: Usage;
  /** end_turn | tool_use | max_tokens | refusal | other */
  stopReason: string;
  model: string;
}

/**
 * A stateful, append-only tool-use conversation. Each provider keeps its own native message history so that
 * provider-specific blocks (e.g. Claude thinking blocks) are passed back unchanged.
 */
export interface ChatSession {
  provider: string;
  model: string;
  sendUser(text: string, images?: ImageInput[]): Promise<TurnResult>;
  sendToolResults(results: ToolResult[], followUpText?: string): Promise<TurnResult>;
}

export interface ChatSessionOptions {
  model: string;
  system: string;
  tools: ToolDef[];
  maxTokens?: number;
  effort?: "low" | "medium" | "high" | "xhigh" | "max";
}

export interface CompleteOptions {
  model: string;
  system?: string;
  prompt: string;
  images?: ImageInput[];
  maxTokens?: number;
  effort?: "low" | "medium" | "high" | "xhigh" | "max";
}

export interface CompleteResult {
  text: string;
  usage: Usage;
  model: string;
}

export interface TextProvider {
  id: string;
  complete(opts: CompleteOptions): Promise<CompleteResult>;
  createSession?(opts: ChatSessionOptions): ChatSession;
  test(): Promise<string>;
}

export interface GeneratedMedia {
  data: Buffer;
  mimeType: string;
  /** Provider-side id for traceability. */
  remoteId?: string;
}

export interface ImageGenOptions {
  model: string;
  prompt: string;
  size?: "1024x1024" | "1024x1536" | "1536x1024";
  n?: number;
}

export interface ImageEditOptions {
  model: string;
  prompt: string;
  image: GeneratedMedia;
  size?: "1024x1024" | "1024x1536" | "1536x1024";
}

export interface ImageProvider {
  id: string;
  generate(opts: ImageGenOptions): Promise<GeneratedMedia[]>;
  edit?(opts: ImageEditOptions): Promise<GeneratedMedia[]>;
  removeBackground?(image: GeneratedMedia): Promise<GeneratedMedia>;
}

export interface VideoGenOptions {
  model: string;
  prompt: string;
  aspect: "9:16" | "16:9" | "1:1";
  durationSec: number;
  /** Optional first-frame image as a data URI. */
  imageDataUri?: string;
}

export interface VideoProvider {
  id: string;
  generate(opts: VideoGenOptions): Promise<GeneratedMedia>;
}

export interface TranscriptionProvider {
  id: string;
  /** Returns SRT subtitles. */
  transcribeToSrt(audio: Buffer, filename: string, model: string): Promise<string>;
}
