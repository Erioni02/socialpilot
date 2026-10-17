import * as LabelPrimitive from "@radix-ui/react-label";
import * as SwitchPrimitive from "@radix-ui/react-switch";
import { cva, type VariantProps } from "class-variance-authority";
import * as React from "react";
import { cn } from "@/lib/utils";

export const Card = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
  <div className={cn("rounded-lg border bg-card text-card-foreground shadow-sm", className)} {...props} />
);
export const CardHeader = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => <div className={cn("flex flex-col gap-1 p-5 pb-3", className)} {...props} />;
export const CardTitle = ({ className, ...props }: React.HTMLAttributes<HTMLHeadingElement>) => <h3 className={cn("text-sm font-semibold leading-none tracking-tight", className)} {...props} />;
export const CardDescription = ({ className, ...props }: React.HTMLAttributes<HTMLParagraphElement>) => <p className={cn("text-sm text-muted-foreground", className)} {...props} />;
export const CardContent = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => <div className={cn("p-5 pt-0", className)} {...props} />;

export const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(({ className, ...props }, ref) => (
  <input
    ref={ref}
    className={cn(
      "flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:opacity-50",
      className
    )}
    {...props}
  />
));
Input.displayName = "Input";

export const Textarea = React.forwardRef<HTMLTextAreaElement, React.TextareaHTMLAttributes<HTMLTextAreaElement>>(({ className, ...props }, ref) => (
  <textarea
    ref={ref}
    className={cn(
      "flex min-h-[80px] w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:opacity-50",
      className
    )}
    {...props}
  />
));
Textarea.displayName = "Textarea";

export const Label = React.forwardRef<React.ElementRef<typeof LabelPrimitive.Root>, React.ComponentPropsWithoutRef<typeof LabelPrimitive.Root>>(({ className, ...props }, ref) => (
  <LabelPrimitive.Root ref={ref} className={cn("text-sm font-medium leading-none", className)} {...props} />
));
Label.displayName = "Label";

const badgeVariants = cva("inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium", {
  variants: {
    variant: {
      default: "border-transparent bg-primary/15 text-primary",
      secondary: "border-transparent bg-secondary text-secondary-foreground",
      success: "border-transparent bg-success/15 text-success",
      warning: "border-transparent bg-warning/15 text-warning",
      destructive: "border-transparent bg-destructive/15 text-destructive",
      outline: "text-muted-foreground"
    }
  },
  defaultVariants: { variant: "default" }
});
export const Badge = ({ className, variant, ...props }: React.HTMLAttributes<HTMLSpanElement> & VariantProps<typeof badgeVariants>) => (
  <span className={cn(badgeVariants({ variant }), className)} {...props} />
);

export const Switch = React.forwardRef<React.ElementRef<typeof SwitchPrimitive.Root>, React.ComponentPropsWithoutRef<typeof SwitchPrimitive.Root>>(({ className, ...props }, ref) => (
  <SwitchPrimitive.Root
    ref={ref}
    className={cn(
      "peer inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full border-2 border-transparent shadow-sm transition-colors disabled:cursor-not-allowed disabled:opacity-50 data-[state=checked]:bg-primary data-[state=unchecked]:bg-input",
      className
    )}
    {...props}
  >
    <SwitchPrimitive.Thumb className="pointer-events-none block h-4 w-4 rounded-full bg-background shadow-lg ring-0 transition-transform data-[state=checked]:translate-x-4 data-[state=unchecked]:translate-x-0" />
  </SwitchPrimitive.Root>
));
Switch.displayName = "Switch";

export const Skeleton = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => <div className={cn("animate-pulse rounded-md bg-muted", className)} {...props} />;

export const Progress = ({ value, className }: { value: number; className?: string }) => (
  <div className={cn("h-1.5 w-full overflow-hidden rounded-full bg-muted", className)} role="progressbar" aria-valuenow={Math.round(value)} aria-valuemin={0} aria-valuemax={100}>
    <div className="h-full bg-primary transition-all duration-500" style={{ width: `${Math.min(100, Math.max(0, value))}%` }} />
  </div>
);

const alertVariants = cva("relative w-full rounded-lg border px-4 py-3 text-sm [&>svg]:absolute [&>svg]:left-4 [&>svg]:top-3.5 [&>svg]:size-4 [&>svg~*]:pl-7", {
  variants: {
    variant: {
      default: "bg-card text-foreground",
      warning: "border-warning/40 bg-warning/10 text-foreground [&>svg]:text-warning",
      destructive: "border-destructive/40 bg-destructive/10 text-foreground [&>svg]:text-destructive",
      info: "border-primary/30 bg-primary/10 text-foreground [&>svg]:text-primary"
    }
  },
  defaultVariants: { variant: "default" }
});
export const Alert = ({ className, variant, ...props }: React.HTMLAttributes<HTMLDivElement> & VariantProps<typeof alertVariants>) => (
  <div role="alert" className={cn(alertVariants({ variant }), className)} {...props} />
);

export const Table = ({ className, ...props }: React.HTMLAttributes<HTMLTableElement>) => (
  <div className="w-full overflow-x-auto">
    <table className={cn("w-full caption-bottom text-sm", className)} {...props} />
  </div>
);
export const Th = ({ className, ...props }: React.ThHTMLAttributes<HTMLTableCellElement>) => <th className={cn("h-9 px-3 text-left align-middle text-xs font-medium text-muted-foreground", className)} {...props} />;
export const Td = ({ className, ...props }: React.TdHTMLAttributes<HTMLTableCellElement>) => <td className={cn("px-3 py-2 align-middle", className)} {...props} />;
export const Tr = ({ className, ...props }: React.HTMLAttributes<HTMLTableRowElement>) => <tr className={cn("border-b transition-colors last:border-0 hover:bg-muted/40", className)} {...props} />;
