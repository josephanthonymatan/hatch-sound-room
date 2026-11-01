import { LoaderCircle, RefreshCw } from "lucide-react";

export function BusyIcon({ size = 16 }: { size?: number }) {
  return (
    <span className="spinner" aria-hidden="true">
      <LoaderCircle size={size} />
    </span>
  );
}

export function RefreshIcon({
  busy,
  size = 16,
}: {
  busy: boolean;
  size?: number;
}) {
  return (
    <span className={busy ? "spinner" : "static-icon"} aria-hidden="true">
      <RefreshCw size={size} />
    </span>
  );
}
