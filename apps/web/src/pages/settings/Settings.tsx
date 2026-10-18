import * as React from "react";
import { useSearchParams } from "react-router-dom";
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ArrowSquareOut, CheckCircle, Copy, Trash, WarningCircle, XCircle, ArrowClockwise } from "@phosphor-icons/react";
import { api } from "@/lib/api";
import { ago, cn, copy, fmtDate, fmtNum, toastError } from "@/lib/utils";
import { PageContainer } from "@/components/layout/AppShell";
import { PlatformIcon, SectionTitle, useMe, useMeta } from "@/components/common";
import {
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
  ConfirmDialog,
  Empty,
  Field,
  Input,
  Mono,
  PageHeader,
  Select,
  SetupCallout,
  Skeleton,
  Table,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  Td,
  Th,
  Tooltip,
} from "@/components/ui";
import { AiProviderKeys, ProviderKeyRow, useProviders, type ProviderStatus } from "@/components/projects/Providers";

// ───────────── Account ─────────────
function AccountTab() {
  const { data: me } = useMe();
  const qc = useQueryClient();
  const [name, setName] = React.useState(me?.name ?? "");
  const [pw, setPw] = React.useState({ current: "", next: "", confirm: "" });
  React.useEffect(() => setName(me?.name ?? ""), [me?.name]);
  const saveName = useMutation({
    mutationFn: () => api.patch("/auth/me", { name: name.trim() }),
    onSuccess: () => {
      toast.success("Name updated");
      qc.invalidateQueries({ queryKey: ["me"] });
    },
    onError: (e) => toastError(e),
  });
  const savePw = useMutation({
    mutationFn: () => api.patch("/auth/me", { currentPassword: pw.current, newPassword: pw.next }),
    onSuccess: () => {
      setPw({ current: "", next: "", confirm: "" });
      toast.success("Password changed. Other sessions were signed out.");
    },
    onError: (e) => toastError(e),
  });
  const pwError = pw.next && pw.next.length < 10 ? "Use at least 10 characters" : pw.confirm && pw.confirm !== pw.next ? "Passwords do not match" : undefined;
  return (
    <div className="grid gap-4 md:grid-cols-2 items-start">
      <Card>
        <CardHeader title="Profile" />
        <CardBody>
          <form
            className="space-y-3"
            onSubmit={(e) => {
              e.preventDefault();
              if (name.trim()) saveName.mutate();
            }}
          >
            <Field label="Email">
              <Input value={me?.email ?? ""} disabled />
            </Field>
            <Field label="Name">
              <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={100} />
            </Field>
            <div className="flex justify-end">
              <Button type="submit" variant="primary" loading={saveName.isPending} disabled={!name.trim() || name.trim() === me?.name}>
                Save
              </Button>
            </div>
          </form>
        </CardBody>
      </Card>
      <Card>
        <CardHeader title="Password" description="Changing it signs out every other session." />
        <CardBody>
          <form
            className="space-y-3"
            onSubmit={(e) => {
              e.preventDefault();
              if (!pwError && pw.current && pw.next && pw.confirm) savePw.mutate();
            }}
          >
            <Field label="Current password">
              <Input type="password" autoComplete="current-password" value={pw.current} onChange={(e) => setPw((s) => ({ ...s, current: e.target.value }))} />
            </Field>
            <Field label="New password">
              <Input type="password" autoComplete="new-password" value={pw.next} onChange={(e) => setPw((s) => ({ ...s, next: e.target.value }))} />
            </Field>
            <Field label="Confirm new password" error={pwError}>
              <Input type="password" autoComplete="new-password" value={pw.confirm} onChange={(e) => setPw((s) => ({ ...s, confirm: e.target.value }))} />
            </Field>
            <div className="flex justify-end">
              <Button type="submit" variant="primary" loading={savePw.isPending} disabled={!!pwError || !pw.current || !pw.next || !pw.confirm}>
                Change password
              </Button>
            </div>
          </form>
        </CardBody>
      </Card>
    </div>
  );
}

// ───────────── Data sources ─────────────
function DataSourcesTab() {
  const { data: meta } = useMeta();
  const { data, isLoading } = useProviders();
  if (!meta || isLoading) return <Skeleton className="h-60" />;
  return (
    <div className="space-y-3">
      <p className="text-[12.5px] text-muted">Optional keys for research and measurement. Discover works with free public sources (Hacker News, GitHub, RSS) without any of these.</p>
      <Card className="divide-y divide-line">
        {Object.entries(meta.dataProviders).map(([id, c]: [string, any]) => (
          <ProviderKeyRow key={id} id={id} name={c.name} description={c.description} docsUrl={c.docsUrl} envVar={c.envVar} status={data?.providers.find((x) => x.provider === id)} />
        ))}
      </Card>
    </div>
  );
}

// ───────────── Developer apps ─────────────
function DeveloperAppCard({ id, entry, status, callback }: { id: string; entry: any; status?: ProviderStatus; callback: string }) {
  const qc = useQueryClient();
  const [open, setOpen] = React.useState(false);
  const [vals, setVals] = React.useState({ clientId: "", clientSecret: "" });
  const [confirmDelete, setConfirmDelete] = React.useState(false);
  const pid = `oauth:${id}`;
  const fields: { key: "clientId" | "clientSecret"; label: string; envVar: string }[] = entry.appCredentialFields ?? [];
  const save = useMutation({
    mutationFn: () => api.put(`/providers/${pid}`, { clientId: vals.clientId.trim(), clientSecret: vals.clientSecret.trim() }),
    onSuccess: () => {
      toast.success(`${entry.name} developer app saved`);
      setVals({ clientId: "", clientSecret: "" });
      setOpen(false);
      qc.invalidateQueries({ queryKey: ["providers"] });
      qc.invalidateQueries({ queryKey: ["integrations"] });
    },
    onError: (e) => toastError(e),
  });
  const del = useMutation({
    mutationFn: () => api.del(`/providers/${pid}`),
    onSuccess: () => {
      toast.success("Developer app removed");
      setConfirmDelete(false);
      qc.invalidateQueries({ queryKey: ["providers"] });
      qc.invalidateQueries({ queryKey: ["integrations"] });
    },
    onError: (e) => toastError(e),
  });
  return (
    <Card>
      <CardHeader
        icon={<PlatformIcon platform={id} size={15} />}
        title={entry.name}
        description={entry.description}
        action={
          status?.configured ? (
            status.source === "env" ? (
              <Badge tone="blue">From env</Badge>
            ) : (
              <Badge tone="green" dot>
                Configured
              </Badge>
            )
          ) : (
            <Badge>Not configured</Badge>
          )
        }
      />
      <CardBody className="space-y-4">
        <Field label="Redirect URI" hint="Register exactly this URL in the provider's developer console.">
          <div className="flex gap-1.5">
            <Input readOnly value={callback} className="font-mono text-[12px]" onFocus={(e) => e.target.select()} />
            <Button type="button" size="icon" onClick={() => copy(callback)} aria-label="Copy redirect URI">
              <Copy size={14} />
            </Button>
          </div>
        </Field>
        <details className="group">
          <summary className="cursor-pointer text-[12.5px] font-medium text-ink-2 hover:text-ink select-none">Setup steps</summary>
          <ol className="mt-2 space-y-1.5 list-decimal pl-5 text-[12.5px] text-ink-2 marker:text-faint">
            {(entry.setupSteps as string[]).map((s, i) => (
              <li key={i}>{s}</li>
            ))}
          </ol>
          {entry.requirements?.length > 0 && (
            <ul className="mt-3 space-y-1">
              {(entry.requirements as string[]).map((r, i) => (
                <li key={i} className="flex gap-1.5 text-[12px] text-muted">
                  <WarningCircle size={13} className="mt-0.5 shrink-0 text-yellow-fg" /> {r}
                </li>
              ))}
            </ul>
          )}
          <a href={entry.docsUrl} target="_blank" rel="noreferrer" className="mt-2 inline-flex items-center gap-1 text-[12px] text-ink underline underline-offset-2">
            Official documentation <ArrowSquareOut size={11} />
          </a>
        </details>
        {status?.source === "env" && (
          <p className="text-[12px] text-muted">
            Using <Mono>{fields.map((f) => f.envVar).join(" / ")}</Mono> from the server environment. Saving here overrides it for your account.
          </p>
        )}
        {open ? (
          <form
            className="space-y-3 rounded-lg border border-line bg-subtle p-3"
            onSubmit={(e) => {
              e.preventDefault();
              if (vals.clientId.trim() && vals.clientSecret.trim()) save.mutate();
            }}
          >
            {fields.map((f) => (
              <Field key={f.key} label={f.label}>
                <Input type={f.key === "clientSecret" ? "password" : "text"} autoComplete="off" value={vals[f.key]} onChange={(e) => setVals((s) => ({ ...s, [f.key]: e.target.value }))} className="font-mono text-[12.5px]" />
              </Field>
            ))}
            <div className="flex justify-end gap-2">
              <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" variant="primary" loading={save.isPending} disabled={!vals.clientId.trim() || !vals.clientSecret.trim()}>
                Save credentials
              </Button>
            </div>
          </form>
        ) : (
          <div className="flex items-center gap-2">
            {status?.hint && <span className="font-mono text-[11.5px] text-muted mr-auto">{status.hint}</span>}
            <div className="flex-1" />
            {status?.source === "user" && (
              <Button size="sm" variant="danger-ghost" onClick={() => setConfirmDelete(true)}>
                <Trash size={13} /> Remove
              </Button>
            )}
            <Button size="sm" variant={status?.configured ? "secondary" : "primary"} onClick={() => setOpen(true)}>
              {status?.configured ? "Replace credentials" : "Add credentials"}
            </Button>
          </div>
        )}
      </CardBody>
      <ConfirmDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title={`Remove the ${entry.name} developer app?`}
        description="Existing connections keep working until their tokens expire, but new connections and token refreshes will fail."
        confirmLabel="Remove"
        danger
        loading={del.isPending}
        onConfirm={() => del.mutate()}
      />
    </Card>
  );
}

function DeveloperAppsTab() {
  const { data: meta } = useMeta();
  const { data, isLoading } = useProviders();
  if (!meta || isLoading)
    return (
      <div className="grid gap-4 md:grid-cols-2">
        <Skeleton className="h-64" />
        <Skeleton className="h-64" />
      </div>
    );
  const ids = Object.keys(meta.integrations).filter((k) => meta.integrations[k].authType === "oauth2");
  return (
    <div className="space-y-4">
      <p className="text-[12.5px] text-muted max-w-3xl">
        OAuth connections need your own developer app on each platform. Credentials are encrypted and never shown again; only a short hint is displayed. They are verified when you connect an account.
      </p>
      <div className="grid gap-4 lg:grid-cols-2 items-start">
        {ids.map((id) => (
          <DeveloperAppCard key={id} id={id} entry={meta.integrations[id]} status={data?.providers.find((x) => x.provider === `oauth:${id}`)} callback={`${meta.oauthCallbackBase}/${id}/callback`} />
        ))}
      </div>
    </div>
  );
}

// ───────────── System status ─────────────
type SystemStatus = {
  queueDriver: string;
  jobs: { waiting: number; active: number; failed24h: number };
  lastWorkerActivity: string | null;
  ffmpeg: { ffmpeg: boolean; version?: string };
  publicBaseUrl: string | null;
  apiPublicUrl: string;
  encryptionKeyConfigured: boolean;
};

function StatusRow({ ok, warn, label, value, note }: { ok: boolean; warn?: boolean; label: string; value: React.ReactNode; note?: React.ReactNode }) {
  return (
    <div className="flex items-start gap-3 px-4 py-3">
      {ok ? <CheckCircle size={16} weight="fill" className="text-green-fg mt-0.5 shrink-0" /> : warn ? <WarningCircle size={16} weight="fill" className="text-yellow-fg mt-0.5 shrink-0" /> : <XCircle size={16} weight="fill" className="text-red-fg mt-0.5 shrink-0" />}
      <div className="min-w-0 flex-1">
        <div className="text-[13px] font-medium text-ink">{label}</div>
        {note && <div className="text-[12px] text-muted">{note}</div>}
      </div>
      <div className="text-[12.5px] text-ink-2 text-right min-w-0 break-all max-w-[50%]">{value}</div>
    </div>
  );
}

function SystemTab() {
  const { data, isLoading, refetch, isFetching } = useQuery({ queryKey: ["jobs", "system-status"], queryFn: () => api.get<SystemStatus>("/system/status"), refetchInterval: 30_000 });
  if (isLoading || !data) return <Skeleton className="h-80" />;
  const workerFresh = data.lastWorkerActivity ? Date.now() - new Date(data.lastWorkerActivity).getTime() < 15 * 60_000 : false;
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-3 gap-3">
        {[
          ["Waiting jobs", data.jobs.waiting],
          ["Active jobs", data.jobs.active],
          ["Failed (24h)", data.jobs.failed24h],
        ].map(([l, v]) => (
          <Card key={l as string} className="p-4">
            <div className="text-[11.5px] text-muted">{l}</div>
            <div className={cn("text-[24px] font-semibold tabular-nums", l === "Failed (24h)" && (v as number) > 0 ? "text-red-fg" : "text-ink")}>{fmtNum(v as number)}</div>
          </Card>
        ))}
      </div>
      <Card className="divide-y divide-line">
        <StatusRow ok label="Queue driver" value={<Mono>{data.queueDriver}</Mono>} note={data.queueDriver === "postgres" ? "Jobs are stored in Postgres (no Redis configured)." : "Jobs run on Redis via BullMQ."} />
        <StatusRow
          ok={workerFresh}
          warn={!workerFresh}
          label="Worker"
          value={data.lastWorkerActivity ? `active ${ago(data.lastWorkerActivity)}` : "never seen"}
          note={workerFresh ? "A worker picked up jobs recently." : "No recent worker activity. If jobs stay queued, start the worker process."}
        />
        <StatusRow ok={data.ffmpeg.ffmpeg} label="FFmpeg" value={data.ffmpeg.ffmpeg ? <span className="font-mono text-[11.5px]">{data.ffmpeg.version?.replace(/^ffmpeg version /, "").split(" ")[0]}</span> : "not found"} note={data.ffmpeg.ffmpeg ? "Video editing, thumbnails and subtitles available." : "Install FFmpeg or set FFMPEG_PATH to enable video editing."} />
        <StatusRow ok={!!data.publicBaseUrl} warn={!data.publicBaseUrl} label="PUBLIC_BASE_URL" value={data.publicBaseUrl ? <Mono>{data.publicBaseUrl}</Mono> : "not set"} note="Instagram and TikTok fetch media from this public HTTPS address when publishing." />
        <StatusRow ok label="API public URL" value={<Mono>{data.apiPublicUrl}</Mono>} note="Base for OAuth redirect URIs." />
        <StatusRow ok={data.encryptionKeyConfigured} label="Encryption key" value={data.encryptionKeyConfigured ? "configured" : "missing"} note="Encrypts API keys and OAuth tokens at rest." />
      </Card>
      <div className="flex justify-end">
        <Button size="sm" variant="ghost" onClick={() => refetch()} loading={isFetching}>
          <ArrowClockwise size={13} /> Refresh
        </Button>
      </div>
    </div>
  );
}

// ───────────── Audit log ─────────────
type AuditItem = { id: string; actor: string; action: string; target: string | null; projectId: string | null; details: any; ip: string | null; createdAt: string };

function AuditLogTab() {
  const [projectId, setProjectId] = React.useState("");
  const projects = useQuery({ queryKey: ["projects"], queryFn: () => api.get<{ projects: { id: string; name: string }[] }>("/projects") });
  const names = new Map((projects.data?.projects ?? []).map((x) => [x.id, x.name]));
  const q = useInfiniteQuery({
    queryKey: ["audit-log", projectId],
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) => {
      const s = new URLSearchParams({ limit: "50" });
      if (projectId) s.set("projectId", projectId);
      if (pageParam) s.set("cursor", pageParam);
      return api.get<{ items: AuditItem[]; nextCursor: string | null }>(`/audit-log?${s}`);
    },
    getNextPageParam: (last) => last.nextCursor,
  });
  const items = q.data?.pages.flatMap((pg) => pg.items) ?? [];
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Select value={projectId} onChange={(e) => setProjectId(e.target.value)} className="w-auto min-w-[200px]">
          <option value="">All projects</option>
          {projects.data?.projects.map((x) => (
            <option key={x.id} value={x.id}>
              {x.name}
            </option>
          ))}
        </Select>
        <div className="flex-1" />
        <Button size="sm" variant="ghost" onClick={() => q.refetch()} loading={q.isRefetching && !q.isFetchingNextPage}>
          <ArrowClockwise size={13} /> Refresh
        </Button>
      </div>
      <Card>
        {q.isLoading ? (
          <div className="p-4 space-y-2">
            {[0, 1, 2, 3, 4].map((i) => (
              <Skeleton key={i} className="h-8" />
            ))}
          </div>
        ) : !items.length ? (
          <Empty title="No audit entries" description="Every sign-in, setting change and outbound action is recorded here." />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Time</Th>
                <Th>Actor</Th>
                <Th>Action</Th>
                <Th>Project</Th>
                <Th>Target</Th>
                <Th>Details</Th>
              </tr>
            </thead>
            <tbody>
              {items.map((a) => {
                const details = a.details && Object.keys(a.details).length ? JSON.stringify(a.details) : "";
                return (
                  <tr key={a.id} className="hover:bg-subtle">
                    <Td className="whitespace-nowrap text-muted tabular-nums">
                      <Tooltip content={fmtDate(a.createdAt, "yyyy-MM-dd HH:mm:ss")}>
                        <span>{fmtDate(a.createdAt, "MMM d, HH:mm")}</span>
                      </Tooltip>
                    </Td>
                    <Td className="whitespace-nowrap">
                      <Badge tone={a.actor === "user" ? "gray" : a.actor.startsWith("agent:") ? "purple" : a.actor.startsWith("automation:") ? "blue" : "yellow"}>{a.actor.split(":")[0]}</Badge>
                      {a.actor.includes(":") && <span className="ml-1 text-[11.5px] text-muted">{a.actor.split(":").slice(1).join(":").slice(0, 24)}</span>}
                    </Td>
                    <Td className="font-mono text-[12px] text-ink whitespace-nowrap">{a.action}</Td>
                    <Td className="text-muted whitespace-nowrap">{a.projectId ? names.get(a.projectId) ?? "—" : "—"}</Td>
                    <Td className="font-mono text-[11.5px] text-muted max-w-[160px] truncate">{a.target ?? "—"}</Td>
                    <Td className="max-w-[320px]">
                      {details ? (
                        <Tooltip content={<span className="font-mono break-all">{details.slice(0, 600)}</span>}>
                          <span className="block truncate font-mono text-[11.5px] text-muted">{details}</span>
                        </Tooltip>
                      ) : (
                        <span className="text-faint">—</span>
                      )}
                      {a.ip && <span className="block text-[11px] text-faint">{a.ip}</span>}
                    </Td>
                  </tr>
                );
              })}
            </tbody>
          </Table>
        )}
      </Card>
      {q.hasNextPage && (
        <div className="flex justify-center">
          <Button onClick={() => q.fetchNextPage()} loading={q.isFetchingNextPage}>
            Load more
          </Button>
        </div>
      )}
    </div>
  );
}

const TABS = [
  ["account", "Account"],
  ["ai", "AI providers"],
  ["data", "Data sources"],
  ["apps", "Developer apps"],
  ["system", "System status"],
  ["audit", "Audit log"],
] as const;

export default function SettingsPage() {
  const [params, setParams] = useSearchParams();
  const tab = TABS.some(([k]) => k === params.get("tab")) ? params.get("tab")! : "account";
  return (
    <PageContainer>
      <PageHeader title="Settings" description="Your account, AI and data provider keys, OAuth developer apps and system health. These apply to all of your projects." />
      <Tabs
        value={tab}
        onValueChange={(v) => {
          const next = new URLSearchParams(params);
          next.set("tab", v);
          setParams(next, { replace: true });
        }}
      >
        <TabsList className="overflow-x-auto scrollbar-thin">
          {TABS.map(([k, l]) => (
            <TabsTrigger key={k} value={k}>
              {l}
            </TabsTrigger>
          ))}
        </TabsList>
        <TabsContent value="account">
          <AccountTab />
        </TabsContent>
        <TabsContent value="ai" className="space-y-3">
          <SectionTitle>Bring your own keys</SectionTitle>
          <p className="text-[12.5px] text-muted max-w-3xl">
            Keys saved here override server environment variables for your account. Values are encrypted and never displayed again — only a short hint. Choose which provider each project uses in Project settings → AI & budget.
          </p>
          <AiProviderKeys />
          <SetupCallout tone="blue" title="Costs">
            Calls are billed by each provider to your key. SocialPilot records estimated costs and stops work when a project's daily, monthly or per-task budget is reached.
          </SetupCallout>
        </TabsContent>
        <TabsContent value="data">
          <DataSourcesTab />
        </TabsContent>
        <TabsContent value="apps">
          <DeveloperAppsTab />
        </TabsContent>
        <TabsContent value="system">
          <SystemTab />
        </TabsContent>
        <TabsContent value="audit">
          <AuditLogTab />
        </TabsContent>
      </Tabs>
    </PageContainer>
  );
}
