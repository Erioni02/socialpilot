import { useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { PageContainer } from "@/components/layout/AppShell";
import { PageHeader, Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui";
import { useProject } from "@/components/common";
import { api, p } from "@/lib/api";
import { useParam, ExtLink } from "@/components/ops/shared";
import { AuditTab } from "@/components/ops/AuditTab";
import { CodeChangesTab } from "@/components/ops/CodeChangesTab";
import { DeploymentsTab } from "@/components/ops/DeploymentsTab";

type Conn = { status: string; config: Record<string, any> };
type CatalogEntry = { id: string; connections: Conn[] };

export default function Website() {
  const { projectId = "" } = useParams();
  const [tab, setTab] = useParam("tab");
  const current = tab === "code" || tab === "deployments" ? tab : "audit";
  const { data: proj } = useProject(projectId);
  const { data: integ } = useQuery({ queryKey: ["integrations", projectId], queryFn: () => api.get<{ catalog: CatalogEntry[] }>(p(projectId, "/integrations")) });

  const live = (id: string) => integ?.catalog.find((c) => c.id === id)?.connections.find((c) => c.status === "connected" || c.status === "error");
  const gh = live("github");
  const vc = live("vercel");
  const github = integ ? { connected: !!gh, repo: gh?.config?.repo as string | undefined, baseBranch: gh?.config?.baseBranch as string | undefined } : null;
  const vercel = integ ? { connected: !!vc, projectName: vc?.config?.projectName as string | undefined } : null;
  const site = proj?.project?.websiteUrl as string | undefined;

  return (
    <PageContainer wide>
      <PageHeader
        eyebrow="Project"
        title="Website"
        description={
          <>
            Evidence-based audits, AI-proposed code changes as pull requests, and deployments with approval.
            {site && (
              <>
                {" "}
                <ExtLink href={site} className="text-[13px]" />
              </>
            )}
          </>
        }
      />
      <Tabs
        value={current}
        onValueChange={(v) => {
          setTab(v === "audit" ? null : v, { replace: true });
        }}
      >
        <TabsList>
          <TabsTrigger value="audit">Audit</TabsTrigger>
          <TabsTrigger value="code">Code changes</TabsTrigger>
          <TabsTrigger value="deployments">Deployments</TabsTrigger>
        </TabsList>
        <TabsContent value="audit">
          <AuditTab projectId={projectId} />
        </TabsContent>
        <TabsContent value="code">
          <CodeChangesTab projectId={projectId} github={github} />
        </TabsContent>
        <TabsContent value="deployments">
          <DeploymentsTab projectId={projectId} vercel={vercel} />
        </TabsContent>
      </Tabs>
    </PageContainer>
  );
}
