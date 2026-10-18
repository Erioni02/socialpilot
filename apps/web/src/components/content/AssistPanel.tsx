import * as React from "react";
import { useMutation } from "@tanstack/react-query";
import { Sparkle, Copy } from "@phosphor-icons/react";
import { api, p } from "@/lib/api";
import { copy, toastError } from "@/lib/utils";
import { Button, Empty, Field, Input, Select, Textarea } from "@/components/ui";
import { CharCount, type SocialPlatform } from "./shared";

export type AssistMode = "rewrite" | "shorten" | "translate" | "hooks" | "hashtags" | "cta" | "variants" | "thread";
export type Suggestion = { label: string; text: string };

const MODES: { id: AssistMode; label: string; hint: string }[] = [
  { id: "rewrite", label: "Rewrite", hint: "3 alternative versions of the body" },
  { id: "shorten", label: "Shorten", hint: "Tighter versions; one fits in 280 characters" },
  { id: "translate", label: "Translate", hint: "Natural translation of the body" },
  { id: "hooks", label: "Hooks", hint: "Scroll-stopping opening lines" },
  { id: "hashtags", label: "Hashtags", hint: "Sets of relevant hashtags" },
  { id: "cta", label: "Call to action", hint: "Clear CTAs for this post" },
  { id: "variants", label: "Platform variants", hint: "One optimized version per selected platform" },
  { id: "thread", label: "X thread", hint: "Turn the body into a thread (≤ 280 chars each)" },
];

export function matchPlatform(label: string): SocialPlatform | null {
  const l = label.toLowerCase();
  if (l.includes("instagram")) return "instagram";
  if (l.includes("tiktok")) return "tiktok";
  if (/\bx\b|twitter/.test(l)) return "x";
  return null;
}

export type AssistApply = {
  body: (text: string) => void;
  prependHook: (text: string) => void;
  hashtags: (tags: string[]) => void;
  cta: (text: string) => void;
  variant: (platform: SocialPlatform, text: string) => void;
  thread: (parts: string[]) => void;
  appendThreadPart: (text: string) => void;
};

/** AI writing helpers — suggestions only; "Apply" writes into the editor form (save to persist). */
export function AssistPanel({ projectId, sourceText, platforms, apply, disabled }: { projectId: string; sourceText: string; platforms: SocialPlatform[]; apply: AssistApply; disabled?: boolean }) {
  const [mode, setMode] = React.useState<AssistMode>("rewrite");
  const [instruction, setInstruction] = React.useState("");
  const [language, setLanguage] = React.useState("Spanish");
  const [text, setText] = React.useState("");
  const [useBody, setUseBody] = React.useState(true);
  const [result, setResult] = React.useState<{ mode: AssistMode; suggestions: Suggestion[] } | null>(null);
  const src = useBody ? sourceText : text;
  const m = useMutation({
    mutationFn: () =>
      api.post<{ suggestions: Suggestion[] }>(p(projectId, "/content/assist"), {
        text: src,
        mode,
        ...(instruction.trim() ? { instruction: instruction.trim() } : {}),
        ...(mode === "translate" ? { language } : {}),
        ...(platforms.length ? { platforms } : {}),
      }),
    onSuccess: (r) => setResult({ mode, suggestions: r.suggestions }),
    onError: (e) => toastError(e),
  });
  const info = MODES.find((x) => x.id === mode)!;
  const parseTags = (t: string) =>
    t
      .split(/[\s,]+/)
      .map((x) => x.replace(/^#/, "").trim())
      .filter(Boolean);

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-1">
        {MODES.map((x) => (
          <button
            key={x.id}
            type="button"
            onClick={() => setMode(x.id)}
            className={`h-8 rounded-md border text-[12px] px-2 truncate ${mode === x.id ? "border-ink bg-ink text-white" : "border-line bg-surface text-ink-2 hover:border-line-strong"}`}
          >
            {x.label}
          </button>
        ))}
      </div>
      <p className="text-[12px] text-muted">{info.hint}</p>
      <div className="flex items-center gap-3 text-[12px]">
        <label className="inline-flex items-center gap-1.5 cursor-pointer">
          <input type="radio" checked={useBody} onChange={() => setUseBody(true)} /> Use master body
        </label>
        <label className="inline-flex items-center gap-1.5 cursor-pointer">
          <input type="radio" checked={!useBody} onChange={() => setUseBody(false)} /> Custom text
        </label>
      </div>
      {!useBody && <Textarea value={text} onChange={(e) => setText(e.target.value)} placeholder="Text to work on" className="min-h-[70px]" />}
      {mode === "translate" && (
        <Field label="Target language">
          <Input value={language} onChange={(e) => setLanguage(e.target.value)} placeholder="e.g. German" />
        </Field>
      )}
      <Field label="Extra instruction (optional)">
        <Input value={instruction} onChange={(e) => setInstruction(e.target.value)} placeholder="e.g. more playful, mention the free trial" />
      </Field>
      <Button variant="primary" size="sm" loading={m.isPending} disabled={!src.trim() || disabled} onClick={() => m.mutate()}>
        <Sparkle size={13} weight="fill" /> Generate suggestions
      </Button>
      {!src.trim() && <p className="text-[12px] text-muted">Write some text first.</p>}

      {result && (
        <div className="pt-2 space-y-2">
          {!result.suggestions.length ? (
            <Empty title="No suggestions returned" />
          ) : (
            <>
              {result.mode === "thread" && (
                <div className="flex justify-end">
                  <Button size="sm" variant="primary" onClick={() => apply.thread(result.suggestions.map((s) => s.text))}>
                    Apply all as X thread
                  </Button>
                </div>
              )}
              {result.mode === "variants" && (
                <div className="flex justify-end">
                  <Button
                    size="sm"
                    variant="primary"
                    onClick={() =>
                      result.suggestions.forEach((s) => {
                        const pl = matchPlatform(s.label);
                        if (pl) apply.variant(pl, s.text);
                      })
                    }
                  >
                    Apply all variants
                  </Button>
                </div>
              )}
              {result.suggestions.map((s, i) => {
                const pl = matchPlatform(s.label);
                return (
                  <div key={i} className="rounded-lg border border-line bg-subtle">
                    <div className="flex items-center justify-between gap-2 px-3 py-1.5 border-b border-line">
                      <span className="text-[11.5px] font-medium text-muted truncate">
                        {s.label || `Suggestion ${i + 1}`} · <CharCount n={s.text.length} max={result.mode === "thread" || pl === "x" ? 280 : 2200} />
                      </span>
                      <div className="flex items-center gap-1 shrink-0">
                        <Button size="icon-sm" variant="ghost" onClick={() => copy(s.text)} aria-label="Copy">
                          <Copy size={12} />
                        </Button>
                        {["rewrite", "shorten", "translate"].includes(result.mode) && (
                          <>
                            <Button size="sm" variant="secondary" onClick={() => apply.body(s.text)}>
                              Apply to body
                            </Button>
                            {platforms.includes("x") && (
                              <Button size="sm" variant="ghost" onClick={() => apply.variant("x", s.text)}>
                                Use for X
                              </Button>
                            )}
                          </>
                        )}
                        {result.mode === "hooks" && (
                          <Button size="sm" variant="secondary" onClick={() => apply.prependHook(s.text)}>
                            Use as opener
                          </Button>
                        )}
                        {result.mode === "hashtags" && (
                          <Button size="sm" variant="secondary" onClick={() => apply.hashtags(parseTags(s.text))}>
                            Apply hashtags
                          </Button>
                        )}
                        {result.mode === "cta" && (
                          <Button size="sm" variant="secondary" onClick={() => apply.cta(s.text)}>
                            Set as CTA
                          </Button>
                        )}
                        {result.mode === "variants" && (
                          <Button size="sm" variant="secondary" disabled={!pl} onClick={() => pl && apply.variant(pl, s.text)}>
                            {pl ? `Apply to ${pl === "x" ? "X" : pl === "instagram" ? "Instagram" : "TikTok"}` : "Unknown platform"}
                          </Button>
                        )}
                        {result.mode === "thread" && (
                          <Button size="sm" variant="ghost" onClick={() => apply.appendThreadPart(s.text)}>
                            Add part
                          </Button>
                        )}
                      </div>
                    </div>
                    <p className="whitespace-pre-wrap text-[13px] text-ink-2 px-3 py-2">{s.text}</p>
                  </div>
                );
              })}
              <p className="text-[11.5px] text-faint">AI suggestions — review before applying. Nothing is saved until you click Save.</p>
            </>
          )}
        </div>
      )}
    </div>
  );
}
