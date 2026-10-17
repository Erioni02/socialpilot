import { Navigate, Route, Routes } from "react-router";
import { AppShell } from "./components/AppShell";
import { Login } from "./pages/Login";
import { Projects } from "./pages/Projects";
import { Approvals } from "./pages/project/Approvals";
import { BrandProfilePage } from "./pages/project/BrandProfilePage";
import { ComingSoonPage } from "./pages/project/ComingSoonPage";
import { Dashboard } from "./pages/project/Dashboard";
import { IntegrationsPage } from "./pages/project/Integrations";
import { ProjectLayout } from "./pages/project/ProjectLayout";
import { SECTIONS } from "./pages/project/sections";
import { Settings } from "./pages/project/Settings";
import { AiProviders } from "./pages/settings/AiProviders";
import { Wizard } from "./pages/wizard/Wizard";

export function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route element={<AppShell />}>
        <Route index element={<Projects />} />
        <Route path="projects/new" element={<Wizard />} />
        <Route path="projects/:id/setup" element={<Wizard />} />
        <Route path="projects/:id" element={<ProjectLayout />}>
          <Route index element={<Dashboard />} />
          <Route path="profile" element={<BrandProfilePage />} />
          <Route path="integrations" element={<IntegrationsPage />} />
          <Route path="approvals" element={<Approvals />} />
          <Route path="settings" element={<Settings />} />
          {SECTIONS.filter((s) => s.cycle !== null).map((s) => (
            <Route key={s.key} path={s.key} element={<ComingSoonPage sectionKey={s.key} />} />
          ))}
        </Route>
        <Route path="settings/ai-providers" element={<AiProviders />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
