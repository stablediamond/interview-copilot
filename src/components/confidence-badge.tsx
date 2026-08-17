import { Badge } from "@/components/ui/badge";
import { CONFIDENCE_LABELS } from "@/lib/constants";
import type { Confidence } from "@/lib/schemas";

export function ConfidenceBadge({ confidence }: { confidence: string }) {
  const c = confidence as Confidence;
  const variant =
    c === "high" ? "success" : c === "medium" ? "warning" : "destructive";
  return <Badge variant={variant}>{CONFIDENCE_LABELS[c] ?? confidence}</Badge>;
}
