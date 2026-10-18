import { providerFetch, ProviderError, isSecretPath } from "@socialpilot/core";

const API = "https://api.github.com";

export interface GithubCreds {
  clientId: string;
  clientSecret: string;
}

export function githubAuthUrl(creds: GithubCreds, redirectUri: string, state: string, scopes: string[]) {
  const p = new URLSearchParams({ client_id: creds.clientId, redirect_uri: redirectUri, scope: scopes.join(" "), state, allow_signup: "false" });
  return `https://github.com/login/oauth/authorize?${p}`;
}

export async function githubExchangeCode(creds: GithubCreds, code: string, redirectUri: string) {
  const r = await providerFetch<any>("github", "https://github.com/login/oauth/access_token", {
    method: "POST",
    headers: { accept: "application/json", "content-type": "application/json" },
    body: JSON.stringify({ client_id: creds.clientId, client_secret: creds.clientSecret, code, redirect_uri: redirectUri }),
  });
  if (r.error) throw new ProviderError("github", r.error_description ?? r.error);
  return { accessToken: r.access_token as string, scopes: String(r.scope ?? "").split(",").filter(Boolean) };
}

export async function githubRevoke(creds: GithubCreds, token: string) {
  await providerFetch("github", `${API}/applications/${creds.clientId}/grant`, {
    method: "DELETE",
    headers: {
      authorization: `Basic ${Buffer.from(`${creds.clientId}:${creds.clientSecret}`).toString("base64")}`,
      accept: "application/vnd.github+json",
      "content-type": "application/json",
    },
    body: JSON.stringify({ access_token: token }),
  });
}

export interface RepoFile {
  path: string;
  type: "blob" | "tree";
  size?: number;
  sha: string;
}

export class GitHubClient {
  constructor(private token: string) {}

  private req<T = any>(path: string, init: RequestInit = {}) {
    return providerFetch<T>("github", path.startsWith("http") ? path : `${API}${path}`, {
      ...init,
      headers: {
        authorization: `Bearer ${this.token}`,
        accept: "application/vnd.github+json",
        "x-github-api-version": "2022-11-28",
        ...(init.body ? { "content-type": "application/json" } : {}),
        ...(init.headers as Record<string, string> | undefined),
      },
    });
  }

  user() {
    return this.req<any>("/user");
  }
  async listRepos() {
    const repos = await this.req<any[]>("/user/repos?per_page=100&sort=updated&affiliation=owner,collaborator,organization_member");
    return repos.map((r) => ({ fullName: r.full_name as string, private: r.private as boolean, defaultBranch: r.default_branch as string, url: r.html_url as string, pushedAt: r.pushed_at }));
  }
  getRepo(repo: string) {
    return this.req<any>(`/repos/${repo}`);
  }
  async branchSha(repo: string, branch: string): Promise<string> {
    const r = await this.req<any>(`/repos/${repo}/git/ref/heads/${encodeURIComponent(branch)}`);
    return r.object.sha;
  }
  async tree(repo: string, ref: string): Promise<{ files: RepoFile[]; truncated: boolean }> {
    const r = await this.req<any>(`/repos/${repo}/git/trees/${encodeURIComponent(ref)}?recursive=1`);
    return { files: (r.tree ?? []).map((t: any) => ({ path: t.path, type: t.type, size: t.size, sha: t.sha })), truncated: !!r.truncated };
  }
  /** Reads a text file. Secret-looking paths are refused so the AI can never read them. */
  async readFile(repo: string, path: string, ref: string): Promise<{ content: string; sha: string; size: number } | null> {
    if (isSecretPath(path)) throw new ProviderError("github", `Refusing to read secret-looking file: ${path}`, 403);
    try {
      const r = await this.req<any>(`/repos/${repo}/contents/${path.split("/").map(encodeURIComponent).join("/")}?ref=${encodeURIComponent(ref)}`);
      if (Array.isArray(r) || r.type !== "file") return null;
      if (r.size > 1_000_000) throw new ProviderError("github", `${path} is larger than 1 MB`);
      return { content: Buffer.from(r.content ?? "", "base64").toString("utf8"), sha: r.sha, size: r.size };
    } catch (e) {
      if (e instanceof ProviderError && e.status === 404) return null;
      throw e;
    }
  }
  async createBranch(repo: string, branch: string, fromSha: string) {
    return this.req(`/repos/${repo}/git/refs`, { method: "POST", body: JSON.stringify({ ref: `refs/heads/${branch}`, sha: fromSha }) });
  }
  /** Creates one commit with all file changes (git data API) and moves the branch to it. */
  async commitFiles(repo: string, branch: string, parentSha: string, files: { path: string; content: string | null }[], message: string): Promise<string> {
    for (const f of files) if (isSecretPath(f.path)) throw new ProviderError("github", `Refusing to write secret-looking file: ${f.path}`, 403);
    const parent = await this.req<any>(`/repos/${repo}/git/commits/${parentSha}`);
    const tree = [];
    for (const f of files) {
      if (f.content === null) {
        tree.push({ path: f.path, mode: "100644", type: "blob", sha: null });
      } else {
        const blob = await this.req<any>(`/repos/${repo}/git/blobs`, { method: "POST", body: JSON.stringify({ content: f.content, encoding: "utf-8" }) });
        tree.push({ path: f.path, mode: "100644", type: "blob", sha: blob.sha });
      }
    }
    const newTree = await this.req<any>(`/repos/${repo}/git/trees`, { method: "POST", body: JSON.stringify({ base_tree: parent.tree.sha, tree }) });
    const commit = await this.req<any>(`/repos/${repo}/git/commits`, { method: "POST", body: JSON.stringify({ message, tree: newTree.sha, parents: [parentSha] }) });
    await this.req(`/repos/${repo}/git/refs/heads/${encodeURIComponent(branch)}`, { method: "PATCH", body: JSON.stringify({ sha: commit.sha, force: false }) });
    return commit.sha as string;
  }
  createPullRequest(repo: string, args: { title: string; body: string; head: string; base: string; draft?: boolean }) {
    return this.req<any>(`/repos/${repo}/pulls`, { method: "POST", body: JSON.stringify(args) });
  }
  getPullRequest(repo: string, n: number) {
    return this.req<any>(`/repos/${repo}/pulls/${n}`);
  }
  mergePullRequest(repo: string, n: number, sha: string, method: "squash" | "merge" | "rebase" = "squash") {
    return this.req<any>(`/repos/${repo}/pulls/${n}/merge`, { method: "PUT", body: JSON.stringify({ merge_method: method, sha }) });
  }
  closePullRequest(repo: string, n: number) {
    return this.req<any>(`/repos/${repo}/pulls/${n}`, { method: "PATCH", body: JSON.stringify({ state: "closed" }) });
  }
  async checks(repo: string, sha: string) {
    const [runs, status] = await Promise.all([
      this.req<any>(`/repos/${repo}/commits/${sha}/check-runs?per_page=50`),
      this.req<any>(`/repos/${repo}/commits/${sha}/status`),
    ]);
    const items = [
      ...(runs.check_runs ?? []).map((c: any) => ({ name: c.name, status: c.status, conclusion: c.conclusion, url: c.html_url, source: "check" })),
      ...(status.statuses ?? []).map((s: any) => ({ name: s.context, status: s.state === "pending" ? "in_progress" : "completed", conclusion: s.state === "success" ? "success" : s.state === "pending" ? null : "failure", url: s.target_url, source: "status" })),
    ];
    const pending = items.some((i) => i.status !== "completed");
    const failed = items.some((i) => i.conclusion && !["success", "neutral", "skipped"].includes(i.conclusion));
    return { items, summary: items.length === 0 ? "none" : pending ? "pending" : failed ? "failure" : "success" };
  }
  /** Preview URLs published by deployment providers (e.g. Vercel) as GitHub deployment statuses. */
  async previewUrl(repo: string, sha: string): Promise<string | null> {
    const deps = await this.req<any[]>(`/repos/${repo}/deployments?sha=${sha}&per_page=10`);
    for (const d of deps) {
      const statuses = await this.req<any[]>(`/repos/${repo}/deployments/${d.id}/statuses?per_page=5`);
      const ok = statuses.find((s) => s.state === "success" && (s.environment_url || s.target_url));
      if (ok) return ok.environment_url || ok.target_url;
    }
    return null;
  }
  async listWorkflows(repo: string) {
    const r = await this.req<any>(`/repos/${repo}/actions/workflows?per_page=50`);
    return (r.workflows ?? []).map((w: any) => ({ id: w.id, name: w.name, path: w.path, state: w.state }));
  }
  dispatchWorkflow(repo: string, workflowId: number | string, ref: string) {
    return this.req(`/repos/${repo}/actions/workflows/${workflowId}/dispatches`, { method: "POST", body: JSON.stringify({ ref }) });
  }
  listCommits(repo: string, branch: string, n = 10) {
    return this.req<any[]>(`/repos/${repo}/commits?sha=${encodeURIComponent(branch)}&per_page=${n}`);
  }
}
