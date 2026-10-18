import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter, Navigate, Route, Routes, useLocation } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "sonner";
import "./index.css";
import { AppShell } from "@/components/layout/AppShell";
import { useMe } from "@/components/common";
import { Spinner } from "@/components/ui";
import { LoginPage, RegisterPage } from "@/pages/Auth";
import ProjectsHome from "@/pages/ProjectsHome";
import NewProject from "@/pages/NewProject";
import DiscoverPage from "@/pages/Discover";
import SettingsPage from "@/pages/settings/Settings";
import ProjectSetup from "@/pages/project/Setup";
import Dashboard from "@/pages/project/Dashboard";
import Workspace from "@/pages/project/Workspace";
import ContentPage from "@/pages/project/Content";
import PostEditor from "@/pages/project/PostEditor";
import Campaigns from "@/pages/project/Campaigns";
import CampaignDetail from "@/pages/project/CampaignDetail";
import CalendarPage from "@/pages/project/Calendar";
import InboxPage from "@/pages/project/Inbox";
import AnalyticsPage from "@/pages/project/Analytics";
import WebsitePage from "@/pages/project/Website";
import IntegrationsPage from "@/pages/project/Integrations";
import AgentsPage from "@/pages/project/Agents";
import ApprovalsPage from "@/pages/project/Approvals";
import AutomationsPage from "@/pages/project/Automations";
import ProjectSettings from "@/pages/project/ProjectSettings";

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: (n, e: any) => n < 1 && !(e?.status >= 400 && e?.status < 500), refetchOnWindowFocus: false, staleTime: 15_000 } },
});

function RequireAuth({ children }: { children: React.ReactNode }) {
  const { data: me, isLoading } = useMe();
  const loc = useLocation();
  if (isLoading)
    return (
      <div className="h-full flex items-center justify-center">
        <Spinner size={20} />
      </div>
    );
  if (!me) return <Navigate to="/login" state={{ from: loc.pathname }} replace />;
  return <>{children}</>;
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/register" element={<RegisterPage />} />
          <Route
            element={
              <RequireAuth>
                <AppShell />
              </RequireAuth>
            }
          >
            <Route index element={<ProjectsHome />} />
            <Route path="/projects/new" element={<NewProject />} />
            <Route path="/discover" element={<DiscoverPage />} />
            <Route path="/settings" element={<SettingsPage />} />
            <Route path="/projects/:projectId">
              <Route index element={<Dashboard />} />
              <Route path="setup" element={<ProjectSetup />} />
              <Route path="workspace" element={<Workspace />} />
              <Route path="content" element={<ContentPage />} />
              <Route path="content/:postId" element={<PostEditor />} />
              <Route path="campaigns" element={<Campaigns />} />
              <Route path="campaigns/:campaignId" element={<CampaignDetail />} />
              <Route path="calendar" element={<CalendarPage />} />
              <Route path="inbox" element={<InboxPage />} />
              <Route path="analytics" element={<AnalyticsPage />} />
              <Route path="website" element={<WebsitePage />} />
              <Route path="integrations" element={<IntegrationsPage />} />
              <Route path="agents" element={<AgentsPage />} />
              <Route path="approvals" element={<ApprovalsPage />} />
              <Route path="automations" element={<AutomationsPage />} />
              <Route path="settings" element={<ProjectSettings />} />
            </Route>
            <Route path="*" element={<Navigate to="/" replace />} />
          </Route>
        </Routes>
      </BrowserRouter>
      <Toaster position="bottom-right" toastOptions={{ style: { fontFamily: "var(--font-sans)", fontSize: 13, border: "1px solid #eaeaea", boxShadow: "0 8px 24px rgba(17,17,17,.06)" } }} />
    </QueryClientProvider>
  </React.StrictMode>,
);
