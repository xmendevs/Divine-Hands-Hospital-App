import { useCallback, useRef, useState, type ReactNode } from "react";
import { theme } from "./theme";
import { Modal } from "./Modal";
import { Button } from "./Button";
import { Icon, type IconName } from "./Icon";

export interface ConfirmOptions {
  title: ReactNode;
  message: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  /** Renders the confirm button with the danger palette (for destructive actions). */
  danger?: boolean;
  icon?: IconName;
}

export interface ConfirmDialogProps {
  open: boolean;
  options: ConfirmOptions | null;
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

/**
 * Confirmation dialog for irreversible operations. Controlled by the caller;
 * see `useConfirm` for the stateful convenience wrapper.
 */
export function ConfirmDialog({ open, options, busy, onConfirm, onCancel }: ConfirmDialogProps) {
  return (
    <Modal
      open={open}
      title={options?.title ?? "Are you sure?"}
      onClose={onCancel}
      width={420}
      footer={
        <>
          <Button variant="outline" onClick={onCancel} disabled={busy}>
            {options?.cancelLabel ?? "Cancel"}
          </Button>
          <Button
            onClick={onConfirm}
            loading={busy}
            style={options?.danger ? { background: theme.action.danger } : undefined}
          >
            {options?.confirmLabel ?? "Confirm"}
          </Button>
        </>
      }
    >
      <div style={{ display: "flex", gap: theme.spacing["3"], alignItems: "flex-start" }}>
        {options?.icon && (
          <Icon
            name={options.icon}
            size={20}
            color={options.danger ? theme.action.danger : theme.action.warning}
            style={{ marginTop: "0.1rem", flexShrink: 0 }}
          />
        )}
        <div
          style={{ fontSize: theme.fontSize.base, color: theme.text.secondary, lineHeight: 1.5 }}
        >
          {options?.message}
        </div>
      </div>
    </Modal>
  );
}

interface ConfirmState {
  options: ConfirmOptions;
}

/**
 * Promise-based confirmation helper. Returns a tuple:
 * `[confirm, dialog]` where `confirm(options)` shows the dialog and resolves
 * with `true`/`false`, and `dialog` is the element to mount once in the page.
 *
 * ```tsx
 * const [confirm, confirmDialog] = useConfirm();
 * if (await confirm({ title: "Void invoice?", message: "...", danger: true })) {
 *   // run the destructive action
 * }
 * ...
 * {confirmDialog}
 * ```
 */
export function useConfirm(): [(options: ConfirmOptions) => Promise<boolean>, ReactNode] {
  const [state, setState] = useState<ConfirmState | null>(null);
  const pendingRef = useRef<((ok: boolean) => void) | null>(null);

  const confirm = useCallback((options: ConfirmOptions) => {
    return new Promise<boolean>((resolve) => {
      pendingRef.current = resolve;
      setState({ options });
    });
  }, []);

  const handleConfirm = useCallback(() => {
    pendingRef.current?.(true);
    pendingRef.current = null;
    setState(null);
  }, []);

  const handleCancel = useCallback(() => {
    pendingRef.current?.(false);
    pendingRef.current = null;
    setState(null);
  }, []);

  const dialog = (
    <ConfirmDialog
      open={state !== null}
      options={state?.options ?? null}
      onConfirm={handleConfirm}
      onCancel={handleCancel}
    />
  );

  return [confirm, dialog];
}
