import * as React from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Megaphone, Plus } from "@phosphor-icons/react";
import { toast } from "sonner";
import { PageContainer } from "@/components/layout/AppShell";
import { Button, Card, Dialog, DialogContent, Empty, Field, Input, PageHeader, Select, Skeleton, StatusBadge, Textarea } from "@/components/ui";
import { api, p } from "@/lib/api";
import { fmtUsd, toastError } from "@/lib/utils";
import { CAMPAIGN_STATUSES, dateRange, PlatformIcons, PlatformToggle, useCampaigns, type Campaign, type SocialPlatform } from "@/components/content/shared";

function CreateCampaignDialog({ projectId, open, onOpenChange }: { projectId: string; open: boolean; onOpenChange: (v: boolean) => void }) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const empty = { name: "", objective: "", targetAudience: "", startDate: "", endDate: "", platforms: [] as SocialPlatform[], pillars: "", guidelines: "", budgetUsd: "" };
  const [f, setF] = React.useState(empty);
  React.useEffect(() => {
    if (open) setF(empty);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  const set = (patch: Partial<typeof f>) => setF((x) => ({ ...x, ...patch }));
  const m = useMutation({
    mutationFn: () =>
      api.post<{ campaign: Campaign }>(p(projectId, "/campaigns"), {
        name: f.name.trim(),
        objective: f.objective,
        targetAudience: f.targetAudience,
        startDate: f.startDate || null,
        endDate: f.endDate || null,
        platforms: f.platforms,
        pillars: f.pillars
          .split("\n")
          .map((x) => x.trim())
          .filter(Boolean)
          .slice(0, 20),
        guidelines: f.guidelines,
        budgetUsd: f.budgetUsd ? Number(f.budgetUsd) : null,
      }),
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ["campaigns"] });
      onOpenChange(false);
      toast.success("Campaign created");
      navigate(`/projects/${projectId}/campaigns/${r.campaign.id}`);
    },
    onError: (e) => toastError(e),
  });
  const invalidDates = !!f.startDate && !!f.endDate && f.endDate < f.startDate;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        title="New campaign"
        description="Group posts and assets around one objective. UTM tags use the campaign slug so web traffic can be attributed."
        className="max-w-xl"
        footer={
          <>
            <Button variant="ghost" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button variant="primary" loading={m.isPending} disabled={!f.name.trim() || invalidDates} onClick={() => m.mutate()}>
              Create campaign
            </Button>
          </>
        }
      >
        <div className="space-y-3.5">
          <Field label="Name">
            <Input value={f.name} onChange={(e) => set({ name: e.target.value })} placeholder="e.g. Spring launch" autoFocus />
          </Field>
          <Field label="Objective">
            <Textarea value={f.objective} onChange={(e) => set({ objective: e.target.value })} placeholder="What should this campaign achieve?" className="min-h-[60px]" />
          </Field>
          <Field label="Target audience">
            <Input value={f.targetAudience} onChange={(e) => set({ targetAudience: e.target.value })} placeholder="Who is it for?" />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Start date">
              <Input type="date" value={f.startDate} onChange={(e) => set({ startDate: e.target.value })} />
            </Field>
            <Field label="End date" error={invalidDates ? "Ends before it starts" : undefined}>
              <Input type="date" value={f.endDate} onChange={(e) => set({ endDate: e.target.value })} />
            </Field>
          </div>
          <Field label="Platforms">
            <PlatformToggle value={f.platforms} onChange={(v) => set({ platforms: v })} />
          </Field>
          <Field label="Content pillars" hint="One per line.">
            <Textarea value={f.pillars} onChange={(e) => set({ pillars: e.target.value })} placeholder={"Product education\nCustomer stories\nBehind the scenes"} className="min-h-[70px]" />
          </Field>
          <Field label="Guidelines">
            <Textarea value={f.guidelines} onChange={(e) => set({ guidelines: e.target.value })} placeholder="Messaging rules, offers, must-mention items" className="min-h-[60px]" />
          </Field>
          <Field label="Budget (USD, optional)">
            <Input type="number" min={0} value={f.budgetUsd} onChange={(e) => set({ budgetUsd: e.target.value })} placeholder="0" />
          </Field>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export default function Campaigns() {
  const { projectId = "" } = useParams();
  const [open, setOpen] = React.useState(false);
  const [status, setStatus] = React.useState("");
  const { data, isLoading } = useCampaigns(projectId);
  const campaigns = (data?.campaigns ?? []).filter((c) => !status || c.status === status);
  return (
    <PageContainer>
      <PageHeader
        title="Campaigns"
        description="Plan, produce and schedule content around a goal — then see what it delivered."
        actions={
          <Button variant="primary" onClick={() => setOpen(true)}>
            <Plus size={14} weight="bold" /> New campaign
          </Button>
        }
      />
      <div className="flex items-center gap-2 mb-4">
        <Select value={status} onChange={(e) => setStatus(e.target.value)} className="w-44">
          <option value="">All statuses</option>
          {CAMPAIGN_STATUSES.map((s) => (
            <option key={s} value={s}>
              {s[0].toUpperCase() + s.slice(1)}
            </option>
          ))}
        </Select>
      </div>
      {isLoading ? (
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-44 rounded-xl" />
          ))}
        </div>
      ) : !campaigns.length ? (
        <Card>
          <Empty
            icon={<Megaphone size={18} />}
            title={status ? "No campaigns with this status" : "No campaigns yet"}
            description="Create a campaign, then let the AI plan a posting schedule grounded in your brand profile."
            action={
              <Button variant="primary" size="sm" onClick={() => setOpen(true)}>
                <Plus size={13} weight="bold" /> New campaign
              </Button>
            }
          />
        </Card>
      ) : (
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {campaigns.map((c) => (
            <Link key={c.id} to={`/projects/${projectId}/campaigns/${c.id}`} className="group">
              <Card className="h-full p-5 flex flex-col transition-colors group-hover:border-line-strong">
                <div className="flex items-start justify-between gap-2">
                  <h3 className="text-[15px] font-semibold text-ink leading-snug group-hover:underline underline-offset-2">{c.name}</h3>
                  <StatusBadge status={c.status} />
                </div>
                <p className="text-[12.5px] text-muted mt-1.5 line-clamp-2 min-h-[38px]">{c.objective || "No objective set."}</p>
                <div className="flex-1" />
                <div className="mt-4 pt-3 border-t border-line grid grid-cols-3 gap-2 text-[12px]">
                  <div>
                    <div className="text-faint">Posts</div>
                    <div className="text-ink font-medium tabular-nums">{c._count?.posts ?? 0}</div>
                  </div>
                  <div>
                    <div className="text-faint">Assets</div>
                    <div className="text-ink font-medium tabular-nums">{c._count?.assets ?? 0}</div>
                  </div>
                  <div>
                    <div className="text-faint">Budget</div>
                    <div className="text-ink font-medium tabular-nums">{c.budgetUsd != null ? fmtUsd(c.budgetUsd) : "—"}</div>
                  </div>
                </div>
                <div className="mt-3 flex items-center justify-between text-[12px] text-muted">
                  <span>{dateRange(c)}</span>
                  <PlatformIcons platforms={c.platforms} size={13} />
                </div>
              </Card>
            </Link>
          ))}
        </div>
      )}
      <CreateCampaignDialog projectId={projectId} open={open} onOpenChange={setOpen} />
    </PageContainer>
  );
}
