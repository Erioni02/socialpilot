import * as React from "react";
import { LinkedAccountsManager } from "@/components/projects/LinkedAccounts";
import { useParams, useSearchParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ArrowsClockwise, BookOpen, CheckCircle, Globe, LinkSimple, Plug, PlugsConnected, Pulse, Trash, User, XCircle, Info } from "@phosphor-icons/react";
import { PageContainer } from "@/components/layout/AppShell";
import { Badge, Button, Card, ConfirmDialog, Dialog, DialogContent, Field, Input, PageHeader, Select, SetupCallout, Skeleton, StatusBadge } from "@/components/ui";
import { CapabilityPill, PlatformIcon, SectionTitle } from "@/components/common";
import { api, p } from "@/lib/api";
import { ago, cn, toastError } from "@/lib/utils";
import { CopyField, ExtLink, KV } from "@/components/ops/shared";

type Capability = { operation: string; label: string; available: boolean; supported: boolean; notes?: string; alternative?: string; missingScopes: string[] };
type Connection = {
  id: string;
  provider: string;
  kind: string;
  status: string;
  accountId?: string | null;
  accountName?: string | null;
  accountHandle?: string | null;
  accountAvatar?: string | null;
  accountUrl?: string | null;
  scopes: string[];
  config: Record<string, any>;
  testResults: Record<string, { ok: boolean; message: string; at: string }>;
  lastTestedAt?: string | null;
  lastSyncAt?: string | null;
  lastError?: string | null;
  tokenExpiresAt?: string | null;
  hasCredentials: boolean;
  capabilities: Capability[] | null;
  createdAt: string;
};
type CatalogEntry = {
  id: string;
  name: string;
  kind: "social" | "analytics" | "repository" | "deployment";
  authType: "oauth2" | "api_key" | "token";
  description: string;
  appCredentialFields?: { key: "clientId" | "clientSecret"; label: string; envVar: string }[];
  connectFields?: { key: string; label: string; secret?: boolean; placeholder?: string; optional?: boolean }[];
  defaultScopes: string[];
  docsUrl: string;
  setupSteps: string[];
  requirements: string[];
  redirectUri: string | null;
  appConfigured: boolean;
  connections: Connection[];
};
type IntegrationsResponse = { catalog: CatalogEntry[]; publicBaseUrl: string | null };

const KINDS: { kind: CatalogEntry["kind"]; label: string; description: string }[] = [
  { kind: "social", label: "Social", description: "Publishing, account metrics and comments through each platform's official API." },
  { kind: "analytics", label: "Analytics", description: "Measured website traffic and conversions." },
  { kind: "repository", label: "Repository", description: "Read code and open pull requests for website changes." },
  { kind: "deployment", label: "Deployment", description: "Preview and production deployments." },
];

const TIKTOK_PRIVACY = [
  ["SELF_ONLY", "Private (only me)"],
  ["MUTUAL_FOLLOW_FRIENDS", "Friends (mutual followers)"],
  ["FOLLOWER_OF_CREATOR", "Followers"],
  ["PUBLIC_TO_EVERYONE", "Public"],
];

export default function Integrations() {
  const { projectId = "" } = useParams();
  const [sp, setSp] = useSearchParams();
  const { data, isLoading, error } = useQuery({ queryKey: ["integrations", projectId], queryFn: () => api.get<IntegrationsResponse>(p(projectId, "/integrations")) });
  const [setupFor, setSetupFor] = React.useState<string | null>(null);
  const [keyFor, setKeyFor] = React.useState<string | null>(null);

  // Query param feedback from the OAuth callback and deep links (?setup=github).
  React.useEffect(() => {
    const connected = sp.get("connected");
    const oauthError = sp.get("oauth_error");
    const setup = sp.get("setup");
    if (connected) toast.success(`${connected === "ga4" ? "Google Analytics" : connected.charAt(0).toUpperCase() + connected.slice(1)} connected`);
    if (oauthError) toast.error(`Connection failed: ${oauthError}`);
    if (setup) setSetupFor(setup);
    if (connected || oauthError) {
      const next = new URLSearchParams(sp);
      next.delete("connected");
      next.delete("oauth_error");
      setSp(next, { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const closeSetup = () => {
    setSetupFor(null);
    if (sp.get("setup")) {
      const next = new URLSearchParams(sp);
      next.delete("setup");
      setSp(next, { replace: true });
    }
  };

  const connect = useConnect(projectId, (provider) => setSetupFor(provider));
  const startConnect = (entry: CatalogEntry) => {
    if (entry.authType === "oauth2") {
      if (!entry.appConfigured) setSetupFor(entry.id);
      else connect.mutate(entry.id);
    } else setKeyFor(entry.id);
  };

  const catalog = data?.catalog ?? [];
  const setupEntry = catalog.find((c) => c.id === setupFor);
  const keyEntry = catalog.find((c) => c.id === keyFor);
  const connectedCount = catalog.reduce((n, c) => n + c.connections.filter((x) => x.status === "connected" || x.status === "linked").length, 0);

  return (
    <PageContainer>
      <PageHeader
        eyebrow="Project"
        title="Integrations"
        description="Link your social accounts by URL for analytics, and connect website analytics, your repository and deployments. SocialPilot never posts to social networks."
        actions={data ? <Badge tone={connectedCount ? "green" : "gray"}>{connectedCount} connected</Badge> : null}
      />

      {error ? (
        <SetupCallout tone="red" title="Could not load integrations">
          {(error as Error).message}
        </SetupCallout>
      ) : isLoading ? (
        <div className="space-y-4">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-40 w-full rounded-xl" />
          ))}
        </div>
      ) : (
        <div className="space-y-10">
          <section>
            <SectionTitle>Social accounts</SectionTitle>
            <LinkedAccountsManager projectId={projectId} />
          </section>
          {KINDS.filter((k) => k.kind !== "social").map((k) => {
            const entries = catalog.filter((c) => c.kind === k.kind);
            if (!entries.length) return null;
            return (
              <section key={k.kind}>
                <SectionTitle>{k.label}</SectionTitle>
                <p className="text-[12.5px] text-muted -mt-2 mb-4">{k.description}</p>
                <div className="space-y-4">
                  {entries.map((entry) => (
                    <ProviderCard
                      key={entry.id}
                      projectId={projectId}
                      entry={entry}
                      connecting={connect.isPending && connect.variables === entry.id}
                      onConnect={() => startConnect(entry)}
                      onSetup={() => setSetupFor(entry.id)}
                    />
                  ))}
                </div>
              </section>
            );
          })}
        </div>
      )}

      {setupEntry && <SetupGuideDialog entry={setupEntry} projectId={projectId} onClose={closeSetup} onConnect={() => connect.mutate(setupEntry.id)} connecting={connect.isPending} />}
      {keyEntry && <KeyConnectDialog entry={keyEntry} projectId={projectId} onClose={() => setKeyFor(null)} />}
    </PageContainer>
  );
}

function useConnect(projectId: string, onSetupNeeded: (provider: string) => void) {
  return useMutation({
    mutationFn: (provider: string) => api.post<{ url: string }>(p(projectId, `/integrations/${provider}/connect`), { redirectTo: `/projects/${projectId}/integrations` }),
    onSuccess: (r) => {
      window.location.href = r.url;
    },
    onError: (e: any, provider) => {
      if (e?.code === "setup_required") onSetupNeeded(provider);
      toastError(e);
    },
  });
}

function ProviderCard({ projectId, entry, onConnect, onSetup, connecting }: { projectId: string; entry: CatalogEntry; onConnect: () => void; onSetup: () => void; connecting: boolean }) {
  const active = entry.connections.filter((c) => c.status !== "public_only");
  const hasLive = active.length > 0;
  return (
    <Card>
      <div className="flex flex-wrap items-start gap-4 px-5 py-4">
        <div className="h-10 w-10 rounded-lg border border-line bg-canvas flex items-center justify-center text-ink shrink-0">
          <PlatformIcon platform={entry.id} size={19} />
        </div>
        <div className="flex-1 min-w-[220px]">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-[14px] font-semibold text-ink">{entry.name}</h3>
            <Badge tone="gray">{entry.authType === "oauth2" ? "OAuth" : entry.authType === "api_key" ? "API key" : "Access token"}</Badge>
            {entry.authType === "oauth2" && !entry.appConfigured && <Badge tone="yellow">Developer app needed</Badge>}
          </div>
          <p className="text-[12.5px] text-muted mt-0.5">{entry.description}</p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <Button size="sm" variant="ghost" onClick={onSetup}>
            <BookOpen size={14} /> Setup guide
          </Button>
          {!hasLive && (
            <Button size="sm" variant="primary" onClick={onConnect} loading={connecting}>
              <Plug size={14} weight="bold" /> Connect
            </Button>
          )}
        </div>
      </div>
      {entry.authType === "oauth2" && !entry.appConfigured && !hasLive && (
        <div className="px-5 pb-4">
          <SetupCallout tone="blue" title={`Register a ${entry.name} developer app first`} action={<Button size="sm" onClick={onSetup}>Open setup guide</Button>}>
            OAuth connections need your own app credentials. The guide lists the exact redirect URI and lets you save the client ID and secret here.
          </SetupCallout>
        </div>
      )}
      {entry.connections.length > 0 && (
        <div className="border-t border-line divide-y divide-line">
          {entry.connections.map((c) => (
            <ConnectionRow key={c.id} projectId={projectId} entry={entry} conn={c} onReconnect={onConnect} reconnecting={connecting} />
          ))}
        </div>
      )}
    </Card>
  );
}

function ConnectionRow({ projectId, entry, conn, onReconnect, reconnecting }: { projectId: string; entry: CatalogEntry; conn: Connection; onReconnect: () => void; reconnecting: boolean }) {
  const qc = useQueryClient();
  const [confirmDisconnect, setConfirmDisconnect] = React.useState(false);
  const invalidate = () => qc.invalidateQueries({ queryKey: ["integrations", projectId] });
  const test = useMutation({
    mutationFn: () => api.post<{ results: Record<string, { ok: boolean; message: string }> }>(p(projectId, `/integrations/${conn.id}/test`)),
    onSuccess: (r) => {
      const vals = Object.values(r.results);
      const failed = vals.filter((v) => !v.ok).length;
      if (failed) toast.warning(`${failed} of ${vals.length} checks failed`);
      else toast.success(`All ${vals.length} checks passed`);
      invalidate();
    },
    onError: (e) => toastError(e),
  });
  const sync = useMutation({
    mutationFn: () => api.post<{ jobId: string }>(p(projectId, `/integrations/${conn.id}/sync`)),
    onSuccess: () => toast.success("Sync started — results appear when the job finishes"),
    onError: (e) => toastError(e),
  });
  const disconnect = useMutation({
    mutationFn: () => api.del<{ revoked: boolean }>(p(projectId, `/integrations/${conn.id}`)),
    onSuccess: (r) => {
      setConfirmDisconnect(false);
      if (conn.status === "public_only") toast.success("Public profile removed");
      else if (r.revoked) toast.success(`Disconnected — access was revoked at ${entry.name}`);
      else toast.success(`Disconnected — stored credentials deleted. Revoke the app in your ${entry.name} account settings if it is still listed.`);
      invalidate();
    },
    onError: (e) => toastError(e),
  });

  const publicOnly = conn.status === "public_only";
  const tests = Object.entries(conn.testResults ?? {});
  const title = conn.accountName || (conn.accountHandle ? `@${conn.accountHandle}` : entry.name);

  return (
    <div className="px-5 py-4">
      <div className="flex flex-wrap items-start gap-3">
        <div className="h-9 w-9 rounded-full border border-line bg-canvas overflow-hidden flex items-center justify-center text-muted shrink-0">
          {conn.accountAvatar ? <img src={conn.accountAvatar} alt="" className="h-full w-full object-cover" referrerPolicy="no-referrer" /> : <User size={16} />}
        </div>
        <div className="flex-1 min-w-[200px]">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[13.5px] font-medium text-ink truncate">{title}</span>
            {conn.accountName && conn.accountHandle && <span className="text-[12.5px] text-muted">@{conn.accountHandle}</span>}
            <StatusBadge status={conn.status} />
          </div>
          {conn.accountUrl && <ExtLink href={conn.accountUrl} className="text-[12px] mt-0.5" />}
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          {publicOnly ? (
            <Button size="sm" variant="primary" onClick={onReconnect} loading={reconnecting}>
              <PlugsConnected size={14} /> Connect with OAuth
            </Button>
          ) : (
            <>
              <Button size="sm" onClick={() => test.mutate()} loading={test.isPending}>
                <Pulse size={14} /> Test
              </Button>
              <Button size="sm" onClick={() => sync.mutate()} loading={sync.isPending}>
                <ArrowsClockwise size={14} /> Sync now
              </Button>
              <Button size="sm" variant="ghost" onClick={onReconnect} loading={reconnecting}>
                Reconnect
              </Button>
            </>
          )}
          <Button size="icon-sm" variant="danger-ghost" onClick={() => setConfirmDisconnect(true)} aria-label="Disconnect">
            <Trash size={14} />
          </Button>
        </div>
      </div>

      {publicOnly ? (
        <div className="mt-3 rounded-lg bg-yellow-bg/50 border border-[#f0e2b6] px-3.5 py-2.5 text-[12.5px] text-ink-2 flex gap-2">
          <Info size={15} className="text-yellow-fg mt-0.5 shrink-0" />
          <span>Public profile only. SocialPilot can reference this account, but it has no API access: no analytics, publishing or comments until you connect with OAuth.</span>
        </div>
      ) : (
        <>
          {conn.lastError && (
            <div className="mt-3">
              <SetupCallout tone="red" title="Connection error">
                <span className="break-words">{conn.lastError}</span>
                {conn.status === "expired" && <span className="block mt-1">The access token expired. Reconnect to renew it.</span>}
              </SetupCallout>
            </div>
          )}

          <div className="mt-4 grid grid-cols-2 sm:grid-cols-4 gap-4">
            <KV label="Last successful sync">{conn.lastSyncAt ? ago(conn.lastSyncAt) : "Never"}</KV>
            <KV label="Last tested">{conn.lastTestedAt ? ago(conn.lastTestedAt) : "Never"}</KV>
            <KV label="Token expires">{conn.tokenExpiresAt ? ago(conn.tokenExpiresAt) : entry.authType === "oauth2" ? "Not reported" : "—"}</KV>
            <KV label="Connected">{ago(conn.createdAt)}</KV>
          </div>

          {conn.scopes.length > 0 && (
            <div className="mt-4">
              <div className="text-[11px] text-muted font-medium mb-1.5">Granted scopes</div>
              <div className="flex flex-wrap gap-1">
                {conn.scopes.map((s) => (
                  <span key={s} className="font-mono text-[11px] rounded border border-line bg-subtle px-1.5 py-0.5 text-ink-2">
                    {s}
                  </span>
                ))}
              </div>
            </div>
          )}

          {conn.capabilities && (
            <div className="mt-4">
              <div className="text-[11px] text-muted font-medium mb-1.5">Capabilities</div>
              <div className="flex flex-wrap gap-1">
                {conn.capabilities.map((cap) => (
                  <CapabilityPill
                    key={cap.operation}
                    available={cap.available}
                    label={cap.label}
                    note={
                      cap.available
                        ? cap.notes ?? "Available"
                        : !cap.supported
                          ? [`Not offered by the official API.`, cap.notes, cap.alternative && `Alternative: ${cap.alternative}`].filter(Boolean).join(" ")
                          : `Missing scopes: ${cap.missingScopes.join(", ")}. Reconnect and approve them.`
                    }
                  />
                ))}
              </div>
            </div>
          )}

          {tests.length > 0 && (
            <div className="mt-4">
              <div className="text-[11px] text-muted font-medium mb-1.5">Last test results</div>
              <ul className="space-y-1">
                {tests.map(([k, r]) => (
                  <li key={k} className="flex items-start gap-2 text-[12.5px]">
                    {r.ok ? <CheckCircle size={15} weight="fill" className="text-green-fg mt-px shrink-0" /> : <XCircle size={15} weight="fill" className="text-red-fg mt-px shrink-0" />}
                    <span className="font-mono text-[11.5px] text-muted shrink-0 mt-px">{k}</span>
                    <span className={cn("min-w-0 break-words", r.ok ? "text-ink-2" : "text-red-fg")}>{r.message}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {(conn.status === "connected" || conn.status === "error") && (
            <>
              {entry.id === "github" && <GitHubConfig projectId={projectId} conn={conn} />}
              {entry.id === "ga4" && <Ga4Config projectId={projectId} conn={conn} />}
              {entry.id === "tiktok" && <TikTokConfig projectId={projectId} conn={conn} />}
            </>
          )}
          {entry.id === "vercel" && conn.config?.projectName && (
            <div className="mt-4 text-[12.5px] text-muted">
              Vercel project <span className="text-ink font-medium">{conn.config.projectName}</span>
              {conn.config.framework ? ` · ${conn.config.framework}` : ""}
            </div>
          )}
          {entry.id === "plausible" && conn.config?.siteId && (
            <div className="mt-4 text-[12.5px] text-muted">
              Site <span className="text-ink font-medium">{conn.config.siteId}</span>
            </div>
          )}
        </>
      )}

      <ConfirmDialog
        open={confirmDisconnect}
        onOpenChange={setConfirmDisconnect}
        title={publicOnly ? "Remove public profile?" : `Disconnect ${entry.name}?`}
        description={
          publicOnly
            ? "The profile URL is removed from this project. No access tokens are involved."
            : `SocialPilot will try to revoke the access token at ${entry.name} and then permanently delete the stored credentials. Scheduled posts, syncs and agent actions that rely on this account will stop until you reconnect.`
        }
        confirmLabel={publicOnly ? "Remove" : "Disconnect"}
        danger
        loading={disconnect.isPending}
        onConfirm={() => disconnect.mutate()}
      >
        {!publicOnly && entry.authType !== "oauth2" && (
          <p className="text-[12.5px] text-muted">{entry.name} tokens cannot be revoked through the API. Delete the token in your {entry.name} account settings to fully revoke access.</p>
        )}
      </ConfirmDialog>
    </div>
  );
}

function ConfigBlock({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mt-4 rounded-lg border border-line bg-subtle px-4 py-3">
      <div className="text-[12px] font-semibold text-ink mb-2">{title}</div>
      {children}
    </div>
  );
}

function useConfigSave(projectId: string, connId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: Record<string, unknown>) => api.patch(p(projectId, `/integrations/${connId}/config`), body),
    onSuccess: () => {
      toast.success("Configuration saved");
      qc.invalidateQueries({ queryKey: ["integrations", projectId] });
    },
    onError: (e) => toastError(e),
  });
}

function GitHubConfig({ projectId, conn }: { projectId: string; conn: Connection }) {
  const current = conn.config?.repo as string | undefined;
  const [editing, setEditing] = React.useState(!current);
  const [repo, setRepo] = React.useState(current ?? "");
  const [branch, setBranch] = React.useState((conn.config?.baseBranch as string) ?? "");
  const repos = useQuery({
    queryKey: ["integrations", projectId, conn.id, "github-repos"],
    queryFn: () => api.get<{ repos: { fullName: string; private: boolean; defaultBranch: string; url: string }[] }>(p(projectId, `/integrations/${conn.id}/github/repos`)),
    enabled: editing,
    staleTime: 60_000,
  });
  const save = useConfigSave(projectId, conn.id);
  return (
    <ConfigBlock title="Repository for this project">
      {!editing && current ? (
        <div className="flex flex-wrap items-center gap-3 text-[12.5px]">
          <ExtLink href={`https://github.com/${current}`}>{current}</ExtLink>
          <span className="text-muted">
            base branch <span className="font-mono text-ink">{conn.config?.baseBranch || "main"}</span>
          </span>
          <Button size="sm" variant="ghost" onClick={() => setEditing(true)}>
            Change
          </Button>
        </div>
      ) : (
        <div className="grid sm:grid-cols-[1fr_180px_auto] gap-2 items-end">
          <Field label="Repository">
            {repos.isLoading ? (
              <Skeleton className="h-8.5 w-full" />
            ) : (
              <Select
                value={repo}
                onChange={(e) => {
                  setRepo(e.target.value);
                  const r = repos.data?.repos.find((x) => x.fullName === e.target.value);
                  if (r) setBranch(r.defaultBranch);
                }}
              >
                <option value="">Choose a repository…</option>
                {repos.data?.repos.map((r) => (
                  <option key={r.fullName} value={r.fullName}>
                    {r.fullName}
                    {r.private ? " (private)" : ""}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field label="Base branch">
            <Input value={branch} onChange={(e) => setBranch(e.target.value)} placeholder="main" className="font-mono text-[12px]" />
          </Field>
          <div className="flex gap-1.5">
            {current && (
              <Button size="md" variant="ghost" onClick={() => setEditing(false)}>
                Cancel
              </Button>
            )}
            <Button
              variant="primary"
              disabled={!repo || !branch.trim()}
              loading={save.isPending}
              onClick={() => save.mutate({ repo, baseBranch: branch.trim() }, { onSuccess: () => setEditing(false) })}
            >
              Save
            </Button>
          </div>
          {repos.error && <p className="text-[12px] text-red-fg sm:col-span-3">{(repos.error as Error).message}</p>}
          <p className="text-[12px] text-muted sm:col-span-3">The AI only commits to new branches and opens pull requests against the base branch. Merging follows the project's approval policy.</p>
        </div>
      )}
    </ConfigBlock>
  );
}

function Ga4Config({ projectId, conn }: { projectId: string; conn: Connection }) {
  const current = conn.config?.propertyId as string | undefined;
  const [editing, setEditing] = React.useState(!current);
  const [prop, setProp] = React.useState(current ?? "");
  const props = useQuery({
    queryKey: ["integrations", projectId, conn.id, "ga4-properties"],
    queryFn: () => api.get<{ properties: { propertyId: string; displayName: string; account: string }[] }>(p(projectId, `/integrations/${conn.id}/ga4/properties`)),
    enabled: editing,
    staleTime: 60_000,
  });
  const save = useConfigSave(projectId, conn.id);
  return (
    <ConfigBlock title="GA4 property">
      {!editing && current ? (
        <div className="flex flex-wrap items-center gap-3 text-[12.5px]">
          <span className="text-ink font-medium">{conn.config?.propertyName ?? "Property"}</span>
          <span className="font-mono text-muted">{current}</span>
          <Button size="sm" variant="ghost" onClick={() => setEditing(true)}>
            Change
          </Button>
        </div>
      ) : (
        <div className="flex flex-wrap items-end gap-2">
          <Field label="Property" className="flex-1 min-w-[240px]">
            {props.isLoading ? (
              <Skeleton className="h-8.5 w-full" />
            ) : (
              <Select value={prop} onChange={(e) => setProp(e.target.value)}>
                <option value="">Choose a property…</option>
                {props.data?.properties.map((x) => (
                  <option key={x.propertyId} value={x.propertyId}>
                    {x.displayName} — {x.account} ({x.propertyId})
                  </option>
                ))}
              </Select>
            )}
          </Field>
          {current && (
            <Button variant="ghost" onClick={() => setEditing(false)}>
              Cancel
            </Button>
          )}
          <Button
            variant="primary"
            disabled={!prop}
            loading={save.isPending}
            onClick={() => {
              const x = props.data?.properties.find((y) => y.propertyId === prop);
              save.mutate({ propertyId: prop, propertyName: x?.displayName ?? prop }, { onSuccess: () => setEditing(false) });
            }}
          >
            Save
          </Button>
          {props.error && <p className="text-[12px] text-red-fg w-full">{(props.error as Error).message}</p>}
          {props.data && !props.data.properties.length && <p className="text-[12px] text-muted w-full">This Google account has no GA4 properties it can read.</p>}
        </div>
      )}
    </ConfigBlock>
  );
}

function TikTokConfig({ projectId, conn }: { projectId: string; conn: Connection }) {
  const save = useConfigSave(projectId, conn.id);
  return (
    <ConfigBlock title="Default privacy level">
      <div className="flex flex-wrap items-center gap-3">
        <Select className="w-auto min-w-[220px]" value={(conn.config?.defaultPrivacyLevel as string) ?? "SELF_ONLY"} onChange={(e) => save.mutate({ defaultPrivacyLevel: e.target.value })} disabled={save.isPending}>
          {TIKTOK_PRIVACY.map(([v, l]) => (
            <option key={v} value={v}>
              {l}
            </option>
          ))}
        </Select>
        <p className="text-[12px] text-muted flex-1 min-w-[220px]">Used when a post doesn't set its own. Until TikTok audits your app, every post is forced to private (SELF_ONLY) regardless of this setting.</p>
      </div>
    </ConfigBlock>
  );
}

function SetupGuideDialog({ entry, projectId, onClose, onConnect, connecting }: { entry: CatalogEntry; projectId: string; onClose: () => void; onConnect: () => void; connecting: boolean }) {
  const qc = useQueryClient();
  const [vals, setVals] = React.useState<Record<string, string>>({});
  const save = useMutation({
    mutationFn: () => api.put(`/providers/oauth:${entry.id}`, { clientId: vals.clientId?.trim(), clientSecret: vals.clientSecret?.trim() }),
    onSuccess: () => {
      toast.success(`${entry.name} developer app saved`);
      setVals({});
      qc.invalidateQueries({ queryKey: ["integrations", projectId] });
    },
    onError: (e) => toastError(e),
  });
  const isOauth = entry.authType === "oauth2";
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent
        className="max-w-2xl"
        title={
          <span className="flex items-center gap-2">
            <PlatformIcon platform={entry.id} /> {entry.name} setup guide
          </span>
        }
        description={entry.description}
        footer={
          <>
            <Button variant="ghost" onClick={onClose}>
              Close
            </Button>
            {isOauth && entry.appConfigured && (
              <Button variant="primary" onClick={onConnect} loading={connecting}>
                <Plug size={14} weight="bold" /> Connect {entry.name}
              </Button>
            )}
          </>
        }
      >
        <div className="space-y-5">
          <div>
            <SectionTitle>Steps</SectionTitle>
            <ol className="space-y-2">
              {entry.setupSteps.map((s, i) => (
                <li key={i} className="flex gap-3 text-[13px] text-ink-2">
                  <span className="h-5 w-5 rounded-full bg-canvas border border-line text-[11px] font-semibold flex items-center justify-center shrink-0 mt-px">{i + 1}</span>
                  <span>{s}</span>
                </li>
              ))}
            </ol>
          </div>

          {entry.redirectUri && (
            <div>
              <SectionTitle>Redirect URI</SectionTitle>
              <CopyField value={entry.redirectUri} />
              <p className="text-[12px] text-muted mt-1.5">Register this exact value in the provider's developer console. It must match character for character.</p>
            </div>
          )}

          {entry.requirements.length > 0 && (
            <div>
              <SectionTitle>Requirements</SectionTitle>
              <ul className="space-y-1 list-disc pl-5 text-[12.5px] text-ink-2">
                {entry.requirements.map((r, i) => (
                  <li key={i}>{r}</li>
                ))}
              </ul>
            </div>
          )}

          <div>
            <SectionTitle>Scopes requested</SectionTitle>
            <div className="flex flex-wrap gap-1">
              {entry.defaultScopes.map((s) => (
                <span key={s} className="font-mono text-[11px] rounded border border-line bg-subtle px-1.5 py-0.5 text-ink-2">
                  {s}
                </span>
              ))}
            </div>
          </div>

          <ExtLink href={entry.docsUrl} className="text-[12.5px]">
            Official documentation
          </ExtLink>

          {isOauth && entry.appCredentialFields && (
            <div className="rounded-lg border border-line px-4 py-3.5">
              <div className="flex items-center justify-between gap-3 mb-3">
                <div className="text-[13px] font-semibold text-ink">Developer app credentials</div>
                {entry.appConfigured ? <Badge tone="green" dot>Configured</Badge> : <Badge tone="yellow" dot>Not configured</Badge>}
              </div>
              <form
                className="grid sm:grid-cols-2 gap-3"
                onSubmit={(e) => {
                  e.preventDefault();
                  save.mutate();
                }}
              >
                {entry.appCredentialFields.map((f) => (
                  <Field key={f.key} label={f.label} hint={<span>or set <code className="font-mono">{f.envVar}</code></span>}>
                    <Input
                      type={f.key === "clientSecret" ? "password" : "text"}
                      autoComplete="off"
                      value={vals[f.key] ?? ""}
                      onChange={(e) => setVals((v) => ({ ...v, [f.key]: e.target.value }))}
                      placeholder={entry.appConfigured ? "Saved — enter to replace" : ""}
                    />
                  </Field>
                ))}
                <div className="sm:col-span-2 flex items-center justify-between gap-3">
                  <p className="text-[12px] text-muted">Stored encrypted for your account and reused across projects.</p>
                  <Button type="submit" variant={entry.appConfigured ? "secondary" : "primary"} loading={save.isPending} disabled={!vals.clientId?.trim() || !vals.clientSecret?.trim()}>
                    Save credentials
                  </Button>
                </div>
              </form>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function KeyConnectDialog({ entry, projectId, onClose }: { entry: CatalogEntry; projectId: string; onClose: () => void }) {
  const qc = useQueryClient();
  const [vals, setVals] = React.useState<Record<string, string>>({});
  const fields = entry.connectFields ?? [];
  const ok = fields.every((f) => f.optional || (vals[f.key] ?? "").trim());
  const connect = useMutation({
    mutationFn: () => api.post(p(projectId, `/integrations/${entry.id}/connect`), { fields: Object.fromEntries(Object.entries(vals).map(([k, v]) => [k, v.trim()]).filter(([, v]) => v)) }),
    onSuccess: () => {
      toast.success(`${entry.name} connected`);
      qc.invalidateQueries({ queryKey: ["integrations", projectId] });
      onClose();
    },
    onError: (e) => toastError(e),
  });
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent
        title={`Connect ${entry.name}`}
        description="Credentials are verified against the provider before saving and stored encrypted."
        footer={
          <>
            <Button variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button variant="primary" disabled={!ok} loading={connect.isPending} onClick={() => connect.mutate()}>
              Connect
            </Button>
          </>
        }
      >
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (ok) connect.mutate();
          }}
        >
          {fields.map((f) => (
            <Field key={f.key} label={`${f.label}${f.optional ? "" : " *"}`}>
              <Input type={f.secret ? "password" : "text"} autoComplete="off" placeholder={f.placeholder} value={vals[f.key] ?? ""} onChange={(e) => setVals((v) => ({ ...v, [f.key]: e.target.value }))} />
            </Field>
          ))}
          <ol className="list-decimal pl-5 text-[12px] text-muted space-y-0.5 pt-1">
            {entry.setupSteps.map((s, i) => (
              <li key={i}>{s}</li>
            ))}
          </ol>
          <ExtLink href={entry.docsUrl} className="text-[12px]">
            Documentation
          </ExtLink>
          <button type="submit" className="hidden" />
        </form>
      </DialogContent>
    </Dialog>
  );
}
