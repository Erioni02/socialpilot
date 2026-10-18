import { providerFetch } from "@socialpilot/core";

const API = "https://api.vercel.com";

export class VercelClient {
  constructor(private token: string, private teamId?: string) {}

  private req<T = any>(path: string, init: RequestInit = {}) {
    const sep = path.includes("?") ? "&" : "?";
    const url = `${API}${path}${this.teamId ? `${sep}teamId=${encodeURIComponent(this.teamId)}` : ""}`;
    return providerFetch<T>("vercel", url, {
      ...init,
      headers: { authorization: `Bearer ${this.token}`, ...(init.body ? { "content-type": "application/json" } : {}) },
    });
  }

  user() {
    return this.req<any>("/v2/user");
  }
  getProject(idOrName: string) {
    return this.req<any>(`/v9/projects/${encodeURIComponent(idOrName)}`);
  }
  async listDeployments(projectId: string, limit = 20) {
    const r = await this.req<any>(`/v6/deployments?projectId=${encodeURIComponent(projectId)}&limit=${limit}`);
    return (r.deployments ?? []).map((d: any) => ({
      id: d.uid as string,
      url: d.url ? `https://${d.url}` : null,
      state: (d.state ?? d.readyState) as string,
      target: (d.target ?? "preview") as string,
      createdAt: new Date(d.created ?? d.createdAt).toISOString(),
      branch: d.meta?.githubCommitRef ?? null,
      commitSha: d.meta?.githubCommitSha ?? null,
      commitMessage: d.meta?.githubCommitMessage ?? null,
      inspectorUrl: d.inspectorUrl ?? null,
    }));
  }
  getDeployment(id: string) {
    return this.req<any>(`/v13/deployments/${encodeURIComponent(id)}`);
  }
  async buildLogs(id: string) {
    const events = await this.req<any[]>(`/v3/deployments/${encodeURIComponent(id)}/events?limit=200`);
    return (Array.isArray(events) ? events : [])
      .map((e: any) => e.payload?.text ?? e.text ?? "")
      .filter(Boolean)
      .slice(-200);
  }
  /** Promote an existing deployment to production (used only after approval). */
  promote(projectId: string, deploymentId: string) {
    return this.req(`/v10/projects/${encodeURIComponent(projectId)}/promote/${encodeURIComponent(deploymentId)}`, { method: "POST" });
  }
  /** Instant rollback to a previous production deployment. */
  rollback(projectId: string, deploymentId: string) {
    return this.req(`/v9/projects/${encodeURIComponent(projectId)}/rollback/${encodeURIComponent(deploymentId)}`, { method: "POST" });
  }
}
