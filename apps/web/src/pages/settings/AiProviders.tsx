import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Pencil, Plus, Trash2, Zap } from "lucide-react";
import { useState, type FormEvent } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Alert, Card, CardContent, Input, Label, Skeleton, Switch, Textarea } from "@/components/ui/primitives";
import { Select } from "@/components/ui/select";
import { api } from "@/lib/api";
import { keys, useProviderCatalog, useProviderFallback, useProviders } from "@/lib/queries";
import type { AiProvider } from "@/lib/types";
import { timeAgo } from "@/lib/utils";
import { ProviderStatus } from "../wizard/StepProviders";

const lines = (text: string) =>
  text
    .split(/[\n,]/)
    .map((s) => s.trim())
    .filter(Boolean);

function ProviderDialog({ open, onOpenChange, editing }: { open: boolean; onOpenChange: (o: boolean) => void; editing: AiProvider | null }) {
  const catalog = useProviderCatalog();
  const queryClient = useQueryClient();
  const [provider, setProvider] = useState(editing?.provider ?? "nvidia");
  const [baseUrl, setBaseUrl] = useState(editing?.baseUrl ?? "");
  const [keysText, setKeysText] = useState("");
  const [modelsText, setModelsText] = useState(editing?.models.join("\n") ?? "");
  const defaults = catalog.data?.find((c) => c.provider === provider);

  const save = useMutation({
    mutationFn: () => {
      const body = { baseUrl: baseUrl.trim() || undefined, keys: lines(keysText), models: lines(modelsText) };
      return editing
        ? api(`/ai-providers/${editing.id}`, { method: "PATCH", body: { ...body, keys: body.keys.length ? body.keys : undefined, models: body.models.length ? body.models : undefined } })
        : api("/ai-providers", { method: "POST", body: { provider, ...body, models: body.models.length ? body.models : undefined } });
    },
    onSuccess: () => {
      toast.success(editing ? "Provider updated" : "Provider added — test it to confirm the key works");
      void queryClient.invalidateQueries({ queryKey: keys.providers });
      onOpenChange(false);
    }
  });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    save.mutate();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{editing ? `Edit ${editing.provider}` : "Add AI provider"}</DialogTitle>
          <DialogDescription>Keys are encrypted on the server and never shown again — only their last four characters.</DialogDescription>
        </DialogHeader>
        <form className="grid gap-4" onSubmit={submit}>
          {!editing && (
            <div className="grid gap-2">
              <Label>Provider</Label>
              <Select value={provider} onValueChange={setProvider} options={(catalog.data ?? []).map((c) => ({ value: c.provider, label: c.provider === "nvidia" ? "NVIDIA (OpenAI-compatible)" : "Ollama Cloud" }))} />
            </div>
          )}
          <div className="grid gap-2">
            <Label htmlFor="base-url">API base URL</Label>
            <Input id="base-url" placeholder={defaults?.baseUrl} value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} />
            <p className="text-xs text-muted-foreground">Leave empty for the default. Must be a public https:// URL.</p>
          </div>
          <div className="grid gap-2">
            <Label htmlFor="keys">API keys (one per line)</Label>
            <Textarea id="keys" rows={3} autoComplete="off" spellCheck={false} placeholder={editing ? `Leave empty to keep ${editing.keysPreview.join(", ")}` : "nvapi-…"} value={keysText} onChange={(e) => setKeysText(e.target.value)} />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="models">Models in failover order (one per line)</Label>
            <Textarea id="models" rows={3} spellCheck={false} placeholder={defaults?.models.join("\n")} value={modelsText} onChange={(e) => setModelsText(e.target.value)} />
          </div>
          {save.isError && <Alert variant="destructive">{save.error.message}</Alert>}
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" loading={save.isPending} disabled={!editing && lines(keysText).length === 0}>
              {editing ? "Save" : "Add provider"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function AiProviders() {
  const providers = useProviders();
  const fallback = useProviderFallback();
  const envNames = fallback.data?.providers.map((p) => `${p.provider} (${p.keyCount} key${p.keyCount === 1 ? "" : "s"})`).join(", ");
  const queryClient = useQueryClient();
  const [dialog, setDialog] = useState<{ open: boolean; editing: AiProvider | null }>({ open: false, editing: null });
  const [removing, setRemoving] = useState<AiProvider | null>(null);
  const invalidate = () => void queryClient.invalidateQueries({ queryKey: keys.providers });

  const test = useMutation({
    mutationFn: (id: string) => api<{ ok: boolean; model?: string; ms?: number; error?: string }>(`/ai-providers/${id}/test`, { method: "POST" }),
    onSuccess: (r) => {
      if (r.ok) toast.success(`Working: ${r.model} answered in ${r.ms} ms`);
      else toast.error(`Test failed: ${r.error}`);
      invalidate();
    },
    onError: (error) => toast.error(error.message)
  });
  const toggle = useMutation({
    mutationFn: ({ id, enabled }: { id: string; enabled: boolean }) => api(`/ai-providers/${id}`, { method: "PATCH", body: { enabled } }),
    onSuccess: invalidate,
    onError: (error) => toast.error(error.message)
  });
  const remove = useMutation({
    mutationFn: (id: string) => api(`/ai-providers/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      toast.success("Provider removed");
      setRemoving(null);
      invalidate();
    },
    onError: (error) => toast.error(error.message)
  });

  return (
    <div className="mx-auto w-full max-w-4xl px-4 py-8">
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">AI providers</h1>
          <p className="mt-1 text-sm text-muted-foreground">Shared by all projects. The AI tries them in order and fails over between providers, models and keys.</p>
        </div>
        <Button onClick={() => setDialog({ open: true, editing: null })}>
          <Plus /> Add provider
        </Button>
      </div>

      {providers.isPending && <Skeleton className="h-32" />}
      {providers.data?.length === 0 && (
        <Alert variant={envNames ? "info" : "warning"} className="mb-4">
          {envNames ? (
            <>No providers saved yet. The AI is currently using keys from <code>.env</code>: {envNames}. Providers you add here take over from them.</>
          ) : (
            <>No AI provider is configured, so AI drafting and summaries can't run. Add one here, or set NVIDIA_API_KEYS / OLLAMA_API_KEYS in <code>.env</code>.</>
          )}
        </Alert>
      )}

      <div className="grid gap-3">
        {providers.data?.map((p) => (
          <Card key={p.id}>
            <CardContent className="flex flex-wrap items-center gap-4 p-4">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="font-medium capitalize">{p.provider}</span>
                  <ProviderStatus provider={p} />
                </div>
                <p className="truncate text-xs text-muted-foreground">
                  {p.baseUrl} · keys {p.keysPreview.join(", ")} · {p.models.join(" → ")}
                </p>
                {p.lastTestResult && !p.lastTestResult.ok && <p className="mt-1 text-xs text-destructive">{p.lastTestResult.error}</p>}
                {p.lastTestAt && <p className="text-xs text-muted-foreground">Tested {timeAgo(p.lastTestAt)}</p>}
              </div>
              <div className="flex items-center gap-2">
                <Switch aria-label="Enabled" checked={p.enabled} onCheckedChange={(enabled) => toggle.mutate({ id: p.id, enabled })} />
                <Button variant="outline" size="sm" onClick={() => test.mutate(p.id)} loading={test.isPending && test.variables === p.id}>
                  <Zap /> Test
                </Button>
                <Button variant="ghost" size="icon" aria-label="Edit" onClick={() => setDialog({ open: true, editing: p })}>
                  <Pencil />
                </Button>
                <Button variant="ghost" size="icon" aria-label="Delete" onClick={() => setRemoving(p)}>
                  <Trash2 />
                </Button>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <Dialog open={removing !== null} onOpenChange={(open) => !open && setRemoving(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Remove the {removing?.provider} provider?</DialogTitle>
            <DialogDescription>Its encrypted keys are deleted. If no providers remain, the AI falls back to keys in .env.</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setRemoving(null)}>
              Cancel
            </Button>
            <Button variant="destructive" loading={remove.isPending} onClick={() => removing && remove.mutate(removing.id)}>
              Remove provider
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {dialog.open && <ProviderDialog open={dialog.open} editing={dialog.editing} onOpenChange={(open) => setDialog((d) => ({ ...d, open }))} />}
    </div>
  );
}
