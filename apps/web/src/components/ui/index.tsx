import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import * as TabsPrimitive from "@radix-ui/react-tabs";
import * as SwitchPrimitive from "@radix-ui/react-switch";
import * as TooltipPrimitive from "@radix-ui/react-tooltip";
import * as DropdownPrimitive from "@radix-ui/react-dropdown-menu";
import * as PopoverPrimitive from "@radix-ui/react-popover";
import * as CheckboxPrimitive from "@radix-ui/react-checkbox";
import { cva, type VariantProps } from "class-variance-authority";
import { Check, CircleNotch, Warning, X } from "@phosphor-icons/react";
import { cn } from "@/lib/utils";

// ───────────── Button ─────────────
const buttonVariants = cva(
  "inline-flex items-center justify-center gap-1.5 whitespace-nowrap font-medium transition-[background,color,transform,border] duration-150 active:scale-[0.98] disabled:pointer-events-none disabled:opacity-45 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink/15 select-none",
  {
    variants: {
      variant: {
        primary: "bg-ink text-white hover:bg-[#333]",
        secondary: "bg-surface text-ink border border-line hover:border-line-strong hover:bg-subtle",
        ghost: "text-ink-2 hover:bg-black/[0.04]",
        danger: "bg-red-fg text-white hover:bg-[#862624]",
        "danger-ghost": "text-red-fg hover:bg-red-bg",
        link: "text-ink underline underline-offset-4 decoration-line-strong hover:decoration-ink px-0",
      },
      size: {
        sm: "h-7 px-2.5 text-[12.5px] rounded-sm",
        md: "h-8.5 px-3.5 text-[13px] rounded-md",
        lg: "h-10 px-5 text-[14px] rounded-md",
        icon: "h-8 w-8 rounded-md",
        "icon-sm": "h-7 w-7 rounded-sm",
      },
    },
    defaultVariants: { variant: "secondary", size: "md" },
  },
);

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonVariants> {
  asChild?: boolean;
  loading?: boolean;
}
export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(({ className, variant, size, asChild, loading, children, disabled, ...props }, ref) => {
  const Comp = asChild ? Slot : "button";
  return (
    <Comp ref={ref} className={cn(buttonVariants({ variant, size }), className)} disabled={disabled || loading} {...props}>
      {asChild ? (
        children
      ) : (
        <>
          {loading && <CircleNotch className="animate-spin" size={14} />}
          {children}
        </>
      )}
    </Comp>
  );
});
Button.displayName = "Button";

// ───────────── Inputs ─────────────
const fieldBase =
  "w-full bg-surface border border-line rounded-md px-3 text-[13px] text-ink placeholder:text-faint transition-colors focus:outline-none focus:border-ink/40 focus:ring-2 focus:ring-ink/5 disabled:opacity-50";
export const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(({ className, ...props }, ref) => (
  <input ref={ref} className={cn(fieldBase, "h-8.5", className)} {...props} />
));
Input.displayName = "Input";

export const Textarea = React.forwardRef<HTMLTextAreaElement, React.TextareaHTMLAttributes<HTMLTextAreaElement>>(({ className, ...props }, ref) => (
  <textarea ref={ref} className={cn(fieldBase, "py-2 min-h-[80px] leading-relaxed resize-y", className)} {...props} />
));
Textarea.displayName = "Textarea";

export const Select = React.forwardRef<HTMLSelectElement, React.SelectHTMLAttributes<HTMLSelectElement>>(({ className, children, ...props }, ref) => (
  <select
    ref={ref}
    className={cn(
      fieldBase,
      "h-8.5 pr-8 appearance-none bg-[url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='10' viewBox='0 0 24 24' fill='none' stroke='%23787774' stroke-width='3'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E\")] bg-no-repeat bg-[right_10px_center]",
      className,
    )}
    {...props}
  >
    {children}
  </select>
));
Select.displayName = "Select";

export function Label({ className, ...props }: React.LabelHTMLAttributes<HTMLLabelElement>) {
  return <label className={cn("text-[12px] font-medium text-ink-2", className)} {...props} />;
}

export function Field({ label, hint, error, children, className }: { label?: React.ReactNode; hint?: React.ReactNode; error?: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      {label && <Label>{label}</Label>}
      {children}
      {error ? <p className="text-[12px] text-red-fg">{error}</p> : hint ? <p className="text-[12px] text-muted">{hint}</p> : null}
    </div>
  );
}

export function Checkbox({ checked, onCheckedChange, label, disabled }: { checked: boolean; onCheckedChange: (v: boolean) => void; label?: React.ReactNode; disabled?: boolean }) {
  return (
    <label className={cn("inline-flex items-center gap-2 text-[13px] cursor-pointer", disabled && "opacity-50 cursor-not-allowed")}>
      <CheckboxPrimitive.Root
        checked={checked}
        disabled={disabled}
        onCheckedChange={(v) => onCheckedChange(v === true)}
        className="h-4 w-4 rounded-[4px] border border-line-strong bg-surface data-[state=checked]:bg-ink data-[state=checked]:border-ink flex items-center justify-center"
      >
        <CheckboxPrimitive.Indicator>
          <Check size={11} weight="bold" className="text-white" />
        </CheckboxPrimitive.Indicator>
      </CheckboxPrimitive.Root>
      {label}
    </label>
  );
}

export function Switch({ checked, onCheckedChange, disabled, label }: { checked: boolean; onCheckedChange: (v: boolean) => void; disabled?: boolean; label?: React.ReactNode }) {
  return (
    <label className={cn("inline-flex items-center gap-2 text-[13px]", disabled ? "opacity-50" : "cursor-pointer")}>
      <SwitchPrimitive.Root
        checked={checked}
        onCheckedChange={onCheckedChange}
        disabled={disabled}
        className="relative h-[18px] w-8 rounded-full bg-line-strong data-[state=checked]:bg-ink transition-colors"
      >
        <SwitchPrimitive.Thumb className="block h-[14px] w-[14px] translate-x-[2px] rounded-full bg-white transition-transform data-[state=checked]:translate-x-[16px]" />
      </SwitchPrimitive.Root>
      {label}
    </label>
  );
}

// ───────────── Surfaces ─────────────
export function Card({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("bg-surface border border-line rounded-xl", className)} {...props} />;
}
export function CardHeader({ title, description, action, className, icon }: { title: React.ReactNode; description?: React.ReactNode; action?: React.ReactNode; className?: string; icon?: React.ReactNode }) {
  return (
    <div className={cn("flex items-start justify-between gap-3 px-5 pt-4 pb-3", className)}>
      <div className="min-w-0">
        <h3 className="text-[13.5px] font-semibold text-ink flex items-center gap-2">
          {icon}
          {title}
        </h3>
        {description && <p className="text-[12.5px] text-muted mt-0.5">{description}</p>}
      </div>
      {action && <div className="shrink-0 flex items-center gap-1.5">{action}</div>}
    </div>
  );
}
export function CardBody({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("px-5 pb-5", className)} {...props} />;
}

const badgeTones = {
  gray: "bg-gray-bg text-gray-fg",
  red: "bg-red-bg text-red-fg",
  blue: "bg-blue-bg text-blue-fg",
  green: "bg-green-bg text-green-fg",
  yellow: "bg-yellow-bg text-yellow-fg",
  purple: "bg-purple-bg text-purple-fg",
  ink: "bg-ink text-white",
};
export type Tone = keyof typeof badgeTones;
export function Badge({ tone = "gray", className, children, dot }: { tone?: Tone; className?: string; children: React.ReactNode; dot?: boolean }) {
  return (
    <span className={cn("inline-flex items-center gap-1 rounded-full px-2 py-[1px] text-[10.5px] font-medium uppercase tracking-[0.05em] whitespace-nowrap", badgeTones[tone], className)}>
      {dot && <span className="h-1.5 w-1.5 rounded-full bg-current opacity-80" />}
      {children}
    </span>
  );
}

const STATUS_TONES: Record<string, Tone> = {
  connected: "green",
  completed: "green",
  published: "green",
  executed: "green",
  approved: "green",
  ok: "green",
  ready: "green",
  merged: "purple",
  replied: "green",
  success: "green",
  READY: "green",
  active: "blue",
  running: "blue",
  planning: "blue",
  publishing: "blue",
  processing: "blue",
  scheduled: "blue",
  queued: "gray",
  pr_open: "blue",
  drafted: "blue",
  draft: "gray",
  new: "gray",
  pending: "yellow",
  in_review: "yellow",
  awaiting_approval: "yellow",
  pending_approval: "yellow",
  manual: "yellow",
  manual_handoff: "yellow",
  partially_published: "yellow",
  public_only: "yellow",
  expired: "yellow",
  untested: "gray",
  escalated: "red",
  failed: "red",
  error: "red",
  ERROR: "red",
  rejected: "red",
  cancelled: "gray",
  closed: "gray",
  disconnected: "gray",
  skipped: "gray",
  ignored: "gray",
  BUILDING: "blue",
  QUEUED: "gray",
  CANCELED: "gray",
};
export function StatusBadge({ status, className }: { status: string; className?: string }) {
  return (
    <Badge tone={STATUS_TONES[status] ?? "gray"} dot className={className}>
      {status.replace(/_/g, " ")}
    </Badge>
  );
}

export function Spinner({ size = 16, className }: { size?: number; className?: string }) {
  return <CircleNotch size={size} className={cn("animate-spin text-muted", className)} />;
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn("animate-pulse-soft rounded-md bg-black/[0.05]", className)} />;
}

export function Empty({ icon, title, description, action, className }: { icon?: React.ReactNode; title: React.ReactNode; description?: React.ReactNode; action?: React.ReactNode; className?: string }) {
  return (
    <div className={cn("flex flex-col items-center justify-center text-center py-12 px-6", className)}>
      {icon && <div className="mb-3 h-10 w-10 rounded-lg bg-canvas border border-line flex items-center justify-center text-muted">{icon}</div>}
      <p className="text-[13.5px] font-medium text-ink">{title}</p>
      {description && <p className="text-[12.5px] text-muted mt-1 max-w-sm">{description}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

/** Shown wherever a feature needs configuration. Never replaced with fake data. */
export function SetupCallout({ title, children, action, tone = "yellow" }: { title: React.ReactNode; children?: React.ReactNode; action?: React.ReactNode; tone?: "yellow" | "blue" | "red" }) {
  const t = { yellow: "bg-yellow-bg/60 border-[#f0e2b6]", blue: "bg-blue-bg/60 border-[#c7e5f7]", red: "bg-red-bg/60 border-[#f3cfd1]" }[tone];
  return (
    <div className={cn("rounded-lg border px-4 py-3 flex items-start gap-3", t)}>
      <Warning size={16} weight="bold" className={cn("mt-0.5 shrink-0", tone === "red" ? "text-red-fg" : tone === "blue" ? "text-blue-fg" : "text-yellow-fg")} />
      <div className="flex-1 min-w-0 text-[12.5px] text-ink-2">
        <p className="font-medium text-ink text-[13px]">{title}</p>
        {children && <div className="mt-0.5">{children}</div>}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}

export function PageHeader({ title, description, actions, eyebrow }: { title: React.ReactNode; description?: React.ReactNode; actions?: React.ReactNode; eyebrow?: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-4 mb-6">
      <div className="min-w-0">
        {eyebrow && <div className="text-[11px] uppercase tracking-[0.08em] text-muted mb-1 font-medium">{eyebrow}</div>}
        <h1 className="serif-title text-[34px] text-ink">{title}</h1>
        {description && <p className="text-[13.5px] text-muted mt-1.5 max-w-2xl">{description}</p>}
      </div>
      {actions && <div className="flex items-center gap-2 flex-wrap">{actions}</div>}
    </div>
  );
}

export function Stat({ label, value, sub, className }: { label: React.ReactNode; value: React.ReactNode; sub?: React.ReactNode; className?: string }) {
  return (
    <div className={cn("min-w-0", className)}>
      <div className="text-[11.5px] text-muted font-medium">{label}</div>
      <div className="text-[24px] font-semibold text-ink tracking-tight leading-tight mt-0.5 tabular-nums">{value}</div>
      {sub && <div className="text-[12px] text-muted mt-0.5">{sub}</div>}
    </div>
  );
}

// ───────────── Dialog ─────────────
export const Dialog = DialogPrimitive.Root;
export const DialogTrigger = DialogPrimitive.Trigger;
export const DialogClose = DialogPrimitive.Close;
export function DialogContent({ title, description, children, className, footer }: { title: React.ReactNode; description?: React.ReactNode; children?: React.ReactNode; className?: string; footer?: React.ReactNode }) {
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-ink/20 backdrop-blur-[2px] data-[state=open]:animate-[enter_200ms_ease-out]" />
      <DialogPrimitive.Content
        className={cn(
          "fixed left-1/2 top-[8vh] z-50 w-[calc(100vw-32px)] max-w-lg -translate-x-1/2 rounded-xl border border-line bg-surface shadow-pop focus:outline-none max-h-[84vh] flex flex-col data-[state=open]:animate-[enter_260ms_cubic-bezier(0.16,1,0.3,1)]",
          className,
        )}
      >
        <div className="flex items-start justify-between gap-4 px-5 pt-4 pb-3 border-b border-line">
          <div>
            <DialogPrimitive.Title className="text-[15px] font-semibold text-ink">{title}</DialogPrimitive.Title>
            {description ? <DialogPrimitive.Description className="text-[12.5px] text-muted mt-0.5">{description}</DialogPrimitive.Description> : <DialogPrimitive.Description className="sr-only">{String(title)}</DialogPrimitive.Description>}
          </div>
          <DialogPrimitive.Close className="text-muted hover:text-ink rounded-sm p-1 -mr-1" aria-label="Close">
            <X size={16} />
          </DialogPrimitive.Close>
        </div>
        <div className="px-5 py-4 overflow-y-auto scrollbar-thin">{children}</div>
        {footer && <div className="px-5 py-3 border-t border-line flex justify-end gap-2 bg-subtle rounded-b-xl">{footer}</div>}
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  );
}

/** Confirmation dialog for irreversible or outward-facing actions; optional typed phrase. */
export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel = "Confirm",
  danger,
  phrase,
  onConfirm,
  loading,
  children,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  title: React.ReactNode;
  description?: React.ReactNode;
  confirmLabel?: string;
  danger?: boolean;
  phrase?: string;
  onConfirm: () => void | Promise<void>;
  loading?: boolean;
  children?: React.ReactNode;
}) {
  const [typed, setTyped] = React.useState("");
  React.useEffect(() => {
    if (!open) setTyped("");
  }, [open]);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        title={title}
        description={description}
        footer={
          <>
            <Button variant="ghost" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button variant={danger ? "danger" : "primary"} loading={loading} disabled={!!phrase && typed !== phrase} onClick={() => onConfirm()}>
              {confirmLabel}
            </Button>
          </>
        }
      >
        {children}
        {phrase && (
          <Field label={<>Type <span className="font-mono text-ink">{phrase}</span> to confirm</>} className="mt-3">
            <Input value={typed} onChange={(e) => setTyped(e.target.value)} autoFocus placeholder={phrase} />
          </Field>
        )}
      </DialogContent>
    </Dialog>
  );
}

// ───────────── Tabs ─────────────
export const Tabs = TabsPrimitive.Root;
export function TabsList({ className, ...props }: React.ComponentProps<typeof TabsPrimitive.List>) {
  return <TabsPrimitive.List className={cn("inline-flex items-center gap-0.5 border-b border-line w-full mb-4", className)} {...props} />;
}
export function TabsTrigger({ className, ...props }: React.ComponentProps<typeof TabsPrimitive.Trigger>) {
  return (
    <TabsPrimitive.Trigger
      className={cn(
        "px-3 py-2 -mb-px text-[13px] text-muted border-b-2 border-transparent hover:text-ink data-[state=active]:text-ink data-[state=active]:border-ink font-medium transition-colors",
        className,
      )}
      {...props}
    />
  );
}
export const TabsContent = TabsPrimitive.Content;

// ───────────── Tooltip / Dropdown / Popover ─────────────
export function Tooltip({ content, children, side = "top" }: { content: React.ReactNode; children: React.ReactNode; side?: "top" | "bottom" | "left" | "right" }) {
  return (
    <TooltipPrimitive.Provider delayDuration={250}>
      <TooltipPrimitive.Root>
        <TooltipPrimitive.Trigger asChild>{children}</TooltipPrimitive.Trigger>
        <TooltipPrimitive.Portal>
          <TooltipPrimitive.Content side={side} sideOffset={6} className="z-[60] rounded-md bg-ink px-2 py-1 text-[11.5px] text-white max-w-xs">
            {content}
          </TooltipPrimitive.Content>
        </TooltipPrimitive.Portal>
      </TooltipPrimitive.Root>
    </TooltipPrimitive.Provider>
  );
}

export const DropdownMenu = DropdownPrimitive.Root;
export const DropdownTrigger = DropdownPrimitive.Trigger;
export function DropdownContent({ className, align = "end", ...props }: React.ComponentProps<typeof DropdownPrimitive.Content>) {
  return (
    <DropdownPrimitive.Portal>
      <DropdownPrimitive.Content align={align} sideOffset={6} className={cn("z-50 min-w-[180px] rounded-lg border border-line bg-surface p-1 shadow-pop", className)} {...props} />
    </DropdownPrimitive.Portal>
  );
}
export function DropdownItem({ className, danger, ...props }: React.ComponentProps<typeof DropdownPrimitive.Item> & { danger?: boolean }) {
  return (
    <DropdownPrimitive.Item
      className={cn("flex items-center gap-2 rounded-md px-2 py-1.5 text-[13px] outline-none cursor-pointer data-[highlighted]:bg-canvas", danger ? "text-red-fg" : "text-ink-2", className)}
      {...props}
    />
  );
}
export const DropdownSeparator = () => <DropdownPrimitive.Separator className="my-1 h-px bg-line" />;
export const DropdownLabel = ({ children }: { children: React.ReactNode }) => <DropdownPrimitive.Label className="px-2 py-1 text-[11px] uppercase tracking-wider text-muted">{children}</DropdownPrimitive.Label>;

export const Popover = PopoverPrimitive.Root;
export const PopoverTrigger = PopoverPrimitive.Trigger;
export function PopoverContent({ className, align = "end", ...props }: React.ComponentProps<typeof PopoverPrimitive.Content>) {
  return (
    <PopoverPrimitive.Portal>
      <PopoverPrimitive.Content align={align} sideOffset={6} className={cn("z-50 rounded-lg border border-line bg-surface shadow-pop", className)} {...props} />
    </PopoverPrimitive.Portal>
  );
}

// ───────────── Misc ─────────────
export function Kbd({ children }: { children: React.ReactNode }) {
  return <kbd>{children}</kbd>;
}

export function Divider({ className }: { className?: string }) {
  return <div className={cn("h-px bg-line", className)} />;
}

export function Mono({ children, className }: { children: React.ReactNode; className?: string }) {
  return <span className={cn("font-mono text-[12px]", className)}>{children}</span>;
}

export function Progress({ value, className, tone = "ink" }: { value: number; className?: string; tone?: "ink" | "red" | "yellow" | "green" }) {
  const color = { ink: "bg-ink", red: "bg-red-fg", yellow: "bg-yellow-fg", green: "bg-green-fg" }[tone];
  return (
    <div className={cn("h-1.5 w-full rounded-full bg-black/[0.06] overflow-hidden", className)}>
      <div className={cn("h-full rounded-full transition-[width] duration-500", color)} style={{ width: `${Math.max(0, Math.min(100, value))}%` }} />
    </div>
  );
}

export function Table({ className, ...props }: React.TableHTMLAttributes<HTMLTableElement>) {
  return (
    <div className="overflow-x-auto scrollbar-thin">
      <table className={cn("w-full text-[13px] border-collapse", className)} {...props} />
    </div>
  );
}
export function Th({ className, ...props }: React.ThHTMLAttributes<HTMLTableCellElement>) {
  return <th className={cn("text-left font-medium text-[11.5px] text-muted px-3 py-2 border-b border-line whitespace-nowrap", className)} {...props} />;
}
export function Td({ className, ...props }: React.TdHTMLAttributes<HTMLTableCellElement>) {
  return <td className={cn("px-3 py-2.5 border-b border-line align-top", className)} {...props} />;
}
