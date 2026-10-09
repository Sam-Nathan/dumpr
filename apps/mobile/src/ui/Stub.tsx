import { View } from 'react-native';
import { Screen } from './Screen';
import { SheetContent } from './Sheet';
import { Text } from './Text';

export interface StubProps {
  /** Screen title as it will ship. */
  title: string;
  /** Screen id from docs/blueprint/screens.md, e.g. "B3". */
  screenId: string;
  /** Who fills it, e.g. "track B". */
  todo: string;
  /** Close (x) instead of back, for modals. */
  modal?: boolean;
}

/** Placeholder for routes registered by the foundation and filled by later tracks. */
export function StubScreen({ title, screenId, todo, modal }: StubProps) {
  return (
    <Screen header={{ title, back: !modal, close: modal }}>
      <StubBody screenId={screenId} todo={todo} />
    </Screen>
  );
}

export function StubSheet({ title, screenId, todo }: StubProps) {
  return (
    <SheetContent title={title}>
      <StubBody screenId={screenId} todo={todo} />
    </SheetContent>
  );
}

function StubBody({ screenId, todo }: Pick<StubProps, 'screenId' | 'todo'>) {
  return (
    <View className="mt-6 items-center rounded-card border border-dashed border-line p-6 dark:border-line-dark">
      <Text variant="stamp" tone="tertiary">
        {screenId}
      </Text>
      <Text variant="body" className="mt-2 text-center">
        Coming soon.
      </Text>
      {__DEV__ ? (
        <Text variant="caption" className="mt-1 text-center">
          TODO({todo})
        </Text>
      ) : null}
    </View>
  );
}
