import { Switch } from 'react-native';
import { FLASH, INK, useScheme } from './theme';

export interface ToggleProps {
  value: boolean;
  onValueChange: (next: boolean) => void;
  /** Spoken name, e.g. "Upload on Wi-Fi only". */
  label: string;
  disabled?: boolean;
  testID?: string;
}

/** On/off switch in the Dumpr palette: lime track when on, neutral when off. */
export function Toggle({ value, onValueChange, label, disabled, testID }: ToggleProps) {
  const dark = useScheme() === 'dark';
  return (
    <Switch
      testID={testID}
      accessibilityLabel={label}
      accessibilityRole="switch"
      value={value}
      disabled={disabled}
      onValueChange={onValueChange}
      trackColor={{ false: dark ? '#3A3842' : '#DAD7DF', true: FLASH }}
      thumbColor={value ? INK : dark ? '#F4F3F6' : '#FFFFFF'}
      ios_backgroundColor={dark ? '#3A3842' : '#DAD7DF'}
    />
  );
}
