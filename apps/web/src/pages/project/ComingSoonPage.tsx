import { Construction } from "lucide-react";
import { Badge, Card, CardContent } from "@/components/ui/primitives";
import { SECTIONS } from "./sections";

/** An honest placeholder: what this section will do and what it needs. Deliberately has no controls. */
export function ComingSoonPage({ sectionKey }: { sectionKey: string }) {
  const section = SECTIONS.find((s) => s.key === sectionKey)!;
  return (
    <div className="grid gap-6">
      <div className="flex items-center gap-3">
        <section.icon className="size-5 text-muted-foreground" />
        <h1 className="text-xl font-semibold tracking-tight">{section.label}</h1>
        <Badge variant="secondary">Coming in Cycle {section.cycle}</Badge>
      </div>
      <Card className="border-dashed">
        <CardContent className="grid gap-4 p-6">
          <div className="flex gap-3">
            <Construction className="mt-0.5 size-5 shrink-0 text-warning" />
            <p className="text-sm leading-relaxed">{section.description}</p>
          </div>
          <div>
            <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">What it will need</p>
            <ul className="grid gap-1.5 text-sm text-muted-foreground">
              {section.needs.map((need) => (
                <li key={need} className="flex gap-2">
                  <span className="text-primary">•</span>
                  {need}
                </li>
              ))}
            </ul>
          </div>
          <p className="text-xs text-muted-foreground">Nothing on this page is simulated: it becomes usable when its cycle ships and its integrations are connected.</p>
        </CardContent>
      </Card>
    </div>
  );
}
