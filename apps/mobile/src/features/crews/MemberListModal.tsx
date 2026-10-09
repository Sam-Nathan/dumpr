import { useState } from 'react';
import { View } from 'react-native';
import type { CrewMember } from '@/data/types-b';
import type { MemberRole } from '@/data/types';
import { Avatar, Button, ListRow, ModalSheet, Text } from '@/ui';
import { memberActions, ROLE_LABEL, type MemberAction } from './summary';

const ACTION_LABEL: Record<MemberAction, string> = {
  make_cohost: 'Make co-host',
  make_member: 'Make member',
  make_host: 'Make host',
  remove: 'Remove from Crew',
};

export interface MemberListModalProps {
  visible: boolean;
  onClose: () => void;
  crewName: string;
  members: CrewMember[];
  meId: string | undefined;
  myRole: MemberRole | undefined;
  onAct: (action: MemberAction, member: CrewMember) => void;
}

/** Member list with roles; hosts / co-hosts get per-member actions behind a tap. */
export function MemberListModal({
  visible,
  onClose,
  crewName,
  members,
  meId,
  myRole,
  onAct,
}: MemberListModalProps) {
  const [selected, setSelected] = useState<CrewMember | null>(null);
  const close = () => {
    setSelected(null);
    onClose();
  };
  const actions = selected ? memberActions(myRole, selected.role) : [];

  return (
    <ModalSheet
      visible={visible}
      onClose={close}
      title={selected ? selected.display_name : 'Members'}
      eyebrow={selected ? ROLE_LABEL[selected.role] : crewName.toUpperCase()}
    >
      {selected ? (
        <View>
          {actions.map((a) => (
            <ListRow
              key={a}
              title={ACTION_LABEL[a]}
              destructive={a === 'remove'}
              onPress={() => {
                const m = selected;
                setSelected(null);
                onAct(a, m);
              }}
            />
          ))}
          <View className="mt-3 items-start">
            <Button label="Back to members" variant="tertiary" onPress={() => setSelected(null)} />
          </View>
        </View>
      ) : (
        <View>
          {members.map((m) => {
            const mine = m.user_id === meId;
            const canAct = !mine && memberActions(myRole, m.role).length > 0;
            return (
              <ListRow
                key={m.user_id}
                title={mine ? `${m.display_name} (you)` : m.display_name}
                subtitle={m.handle ? `@${m.handle}` : undefined}
                left={<Avatar name={m.display_name} avatarKey={m.avatar_key} ring={m.ring_color} size={44} />}
                right={
                  m.role !== 'member' ? (
                    <Text variant="stamp" tone="tertiary" className="text-[11px]">
                      {ROLE_LABEL[m.role]}
                    </Text>
                  ) : canAct ? undefined : (
                    <View />
                  )
                }
                onPress={canAct ? () => setSelected(m) : undefined}
                accessibilityLabel={`${m.display_name}${m.role !== 'member' ? `, ${ROLE_LABEL[m.role].toLowerCase()}` : ''}`}
              />
            );
          })}
        </View>
      )}
    </ModalSheet>
  );
}
