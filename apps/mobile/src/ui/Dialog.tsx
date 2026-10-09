import { Modal, Pressable, View } from 'react-native';
import { create } from 'zustand';
import { Button } from './Button';
import { Text } from './Text';

export interface DialogProps {
  visible: boolean;
  /** Question that names the thing: "Delete Goa Gang for everyone?" */
  title: string;
  /** The consequence: "6 members get 30 days to download their copies. This can't be undone." */
  body: string;
  /** A verb: "Delete", "Leave", "Remove". Never "OK" / "Yes". */
  confirmLabel: string;
  cancelLabel?: string;
  /** Red confirm (default true; dialogs are for irreversible actions). */
  destructive?: boolean;
  loading?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

/**
 * Dialog: ONLY for irreversible actions. Verb on the button, consequence in the body. Anything
 * reversible should be an Undo toast instead.
 */
export function Dialog({
  visible,
  title,
  body,
  confirmLabel,
  cancelLabel = 'Cancel',
  destructive = true,
  loading,
  onConfirm,
  onCancel,
}: DialogProps) {
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onCancel} statusBarTranslucent>
      <View className="flex-1 items-center justify-center bg-black/50 px-6">
        <Pressable
          accessibilityLabel="Dismiss"
          accessibilityRole="button"
          className="absolute inset-0"
          onPress={onCancel}
        />
        <View
          accessibilityViewIsModal
          className="w-full max-w-[400px] rounded-card bg-surface p-6 dark:bg-surface-dark"
        >
          <Text variant="title" heading className="mb-2">
            {title}
          </Text>
          <Text variant="body" className="mb-5">
            {body}
          </Text>
          <View className="flex-row items-center justify-end gap-2">
            <Button label={cancelLabel} variant="tertiary" onPress={onCancel} />
            <Button
              label={confirmLabel}
              variant={destructive ? 'destructive' : 'strong'}
              loading={loading}
              onPress={onConfirm}
            />
          </View>
        </View>
      </View>
    </Modal>
  );
}

interface DialogRequest extends Omit<DialogProps, 'visible' | 'onConfirm' | 'onCancel' | 'loading'> {
  resolve: (confirmed: boolean) => void;
}

interface DialogStore {
  request: DialogRequest | null;
}

const useDialogStore = create<DialogStore>(() => ({ request: null }));

/**
 * Imperative confirm: `if (await confirmDialog({ title, body, confirmLabel: 'Delete' })) { ... }`.
 * Resolves false on cancel / back / backdrop tap.
 */
export function confirmDialog(opts: Omit<DialogRequest, 'resolve'>): Promise<boolean> {
  return new Promise((resolve) => {
    useDialogStore.getState().request?.resolve(false);
    useDialogStore.setState({ request: { ...opts, resolve } });
  });
}

/** Mount once in the root layout. */
export function DialogHost() {
  const request = useDialogStore((s) => s.request);
  const close = (value: boolean) => {
    request?.resolve(value);
    useDialogStore.setState({ request: null });
  };
  if (!request) return null;
  const { resolve: _resolve, ...props } = request;
  return <Dialog {...props} visible onConfirm={() => close(true)} onCancel={() => close(false)} />;
}
