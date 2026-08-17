import { Badge } from "@/components/ui/badge";

export function FieldChips({
  label,
  items,
  variant = "secondary",
}: {
  label: string;
  items: string[];
  variant?: React.ComponentProps<typeof Badge>["variant"];
}) {
  return (
    <div className="space-y-1.5">
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </p>
      {items.length === 0 ? (
        <p className="text-sm text-muted-foreground/70">—</p>
      ) : (
        <div className="flex flex-wrap gap-1.5">
          {items.map((item, i) => (
            <Badge key={`${item}-${i}`} variant={variant} className="font-normal">
              {item}
            </Badge>
          ))}
        </div>
      )}
    </div>
  );
}

export function FieldText({ label, value }: { label: string; value: string }) {
  return (
    <div className="space-y-1">
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </p>
      <p className="text-sm">{value || "—"}</p>
    </div>
  );
}
