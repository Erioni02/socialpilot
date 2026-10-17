import { QueryClient, useQuery } from "@tanstack/react-query";
import { api, ApiError } from "./api";
import type { AiProvider, Approval, AuditEntry, BrandProfileDTO, Integration, Me, Policy, Project, ProjectListItem, ProviderCatalogItem, ProviderFallback, Spend, TaskDetail, TaskSummary, WebsiteSnapshot } from "./types";

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: (count, error) => !(error instanceof ApiError && error.status < 500) && count < 2, staleTime: 10_000, refetchOnWindowFocus: false }
  }
});

export const keys = {
  me: ["me"] as const,
  projects: ["projects"] as const,
  project: (id: string) => ["project", id] as const,
  profile: (id: string) => ["project", id, "profile"] as const,
  website: (id: string) => ["project", id, "website"] as const,
  integrations: (id: string) => ["project", id, "integrations"] as const,
  policy: (id: string) => ["project", id, "policy"] as const,
  tasks: (id: string) => ["project", id, "tasks"] as const,
  task: (taskId: string) => ["task", taskId] as const,
  approvals: (id: string) => ["project", id, "approvals"] as const,
  audit: (id: string) => ["project", id, "audit"] as const,
  spend: (id: string) => ["project", id, "spend"] as const,
  providers: ["ai-providers"] as const,
  catalog: ["ai-providers", "catalog"] as const,
  fallback: ["ai-providers", "fallback"] as const
};

export const useMe = () => useQuery({ queryKey: keys.me, queryFn: () => api<Me>("/auth/me"), retry: false });
export const useProjects = () => useQuery({ queryKey: keys.projects, queryFn: () => api<ProjectListItem[]>("/projects") });
export const useProject = (id: string) => useQuery({ queryKey: keys.project(id), queryFn: () => api<Project>(`/projects/${id}`), enabled: Boolean(id) });
export const useProfile = (id: string) => useQuery({ queryKey: keys.profile(id), queryFn: () => api<BrandProfileDTO | null>(`/projects/${id}/brand-profile`) });
export const useWebsite = (id: string) => useQuery({ queryKey: keys.website(id), queryFn: () => api<WebsiteSnapshot | null>(`/projects/${id}/website`) });
export const useIntegrations = (id: string) => useQuery({ queryKey: keys.integrations(id), queryFn: () => api<Integration[]>(`/projects/${id}/integrations`) });
export const usePolicy = (id: string) => useQuery({ queryKey: keys.policy(id), queryFn: () => api<Policy>(`/projects/${id}/policy`) });
export const useTasks = (id: string) => useQuery({ queryKey: keys.tasks(id), queryFn: () => api<TaskSummary[]>(`/projects/${id}/tasks?limit=20`) });
export const useTask = (taskId: string | null) =>
  useQuery({ queryKey: keys.task(taskId ?? "none"), queryFn: () => api<TaskDetail>(`/tasks/${taskId}`), enabled: Boolean(taskId) });
export const useApprovals = (id: string) => useQuery({ queryKey: keys.approvals(id), queryFn: () => api<Approval[]>(`/projects/${id}/approvals`) });
export const useAudit = (id: string) => useQuery({ queryKey: keys.audit(id), queryFn: () => api<AuditEntry[]>(`/projects/${id}/audit?limit=20`) });
export const useSpend = (id: string) => useQuery({ queryKey: keys.spend(id), queryFn: () => api<Spend>(`/projects/${id}/spend`) });
export const useProviders = () => useQuery({ queryKey: keys.providers, queryFn: () => api<AiProvider[]>("/ai-providers") });
export const useProviderCatalog = () => useQuery({ queryKey: keys.catalog, queryFn: () => api<ProviderCatalogItem[]>("/ai-providers/catalog"), staleTime: Infinity });
export const useProviderFallback = () => useQuery({ queryKey: keys.fallback, queryFn: () => api<ProviderFallback>("/ai-providers/fallback") });
