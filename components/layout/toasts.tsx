"use client";

import { useEffect } from "react";
import { AlertTriangle, CheckCircle2, Info, ShieldAlert, X } from "lucide-react";
import { cx } from "@/lib/format";
import { useSimStore, type ToastMessage } from "@/lib/store/sim-store";

/**
 * Toast notifications.
 *
 * Announced through a polite live region so a screen-reader user hears an
 * incident begin without the announcement interrupting whatever they are
 * reading. Each toast dismisses itself; criticals linger longer because they
 * matter more.
 */

const ICONS = {
  critical: ShieldAlert,
  warning: AlertTriangle,
  info: Info,
  success: CheckCircle2,
};

const TONE_CLASS = {
  critical: "border-crit/30 bg-crit-dim/90 text-crit",
  warning: "border-warn/30 bg-warn-dim/90 text-warn",
  info: "border-info/30 bg-info-dim/90 text-info",
  success: "border-ok/30 bg-ok-dim/90 text-ok",
};

const DURATION = {
  critical: 7000,
  warning: 5000,
  info: 4000,
  success: 4500,
};

function Toast({ toast, onDismiss }: { toast: ToastMessage; onDismiss: () => void }) {
  const Icon = ICONS[toast.severity];

  useEffect(() => {
    const timer = setTimeout(onDismiss, DURATION[toast.severity]);
    return () => clearTimeout(timer);
  }, [onDismiss, toast.severity]);

  return (
    <div
      className={cx(
        "anim-slide-in pointer-events-auto flex w-full items-start gap-2.5 rounded-lg border bg-surface-2/95 px-3 py-2.5 shadow-xl backdrop-blur-md",
        TONE_CLASS[toast.severity],
      )}
    >
      <Icon size={15} className="mt-px shrink-0" aria-hidden="true" />
      <div className="min-w-0 flex-1">
        <p className="text-[12.5px] font-medium leading-snug text-ink">{toast.title}</p>
        {toast.detail ? (
          <p className="mt-0.5 text-[11.5px] leading-snug text-ink-3">{toast.detail}</p>
        ) : null}
      </div>
      <button
        type="button"
        onClick={onDismiss}
        className="-mr-1 -mt-0.5 shrink-0 rounded p-1 text-ink-4 transition-colors hover:bg-surface-3 hover:text-ink"
        aria-label="Dismiss notification"
      >
        <X size={13} />
      </button>
    </div>
  );
}

export function ToastViewport() {
  const toasts = useSimStore((s) => s.toasts);
  const dismissToast = useSimStore((s) => s.dismissToast);

  return (
    <div
      role="region"
      aria-label="Notifications"
      className="pointer-events-none fixed bottom-4 right-4 z-[120] flex w-[min(340px,calc(100vw-2rem))] flex-col gap-2"
    >
      <div aria-live="polite" aria-atomic="false" className="sr-only">
        {toasts.map((t) => (
          <p key={t.id}>{t.title}</p>
        ))}
      </div>
      {toasts.map((toast) => (
        <Toast key={toast.id} toast={toast} onDismiss={() => dismissToast(toast.id)} />
      ))}
    </div>
  );
}
