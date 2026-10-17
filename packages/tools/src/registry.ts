import type { AnyTool, ToolDef } from "./types";

const tools = new Map<string, AnyTool>();

export function registerTool<I, O>(def: ToolDef<I, O>): void {
  tools.set(def.name, def as AnyTool);
}

export function getTool(name: string): AnyTool | undefined {
  return tools.get(name);
}

export function listTools(): AnyTool[] {
  return [...tools.values()];
}

/** Test helper. */
export function clearRegistry(): void {
  tools.clear();
}
