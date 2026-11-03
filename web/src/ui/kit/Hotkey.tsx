import { ArrowBigUpIcon, Command, Delete } from "lucide-react";
import { type ReactNode, useMemo } from "react";

import { useClientValue } from "./clientValue";
import { Center, Flexbox } from "./Flex";
import { Icon } from "./Icon";

/*
 * `keys` joins key names with `+` (`mod+k`). `mod`, `shift` and `backspace`
 * are drawn as symbols on Apple devices and spelled out elsewhere; any other
 * key is shown uppercased.
 */

export interface HotkeyProps {
  /** Puts all keys in one keycap, as after a tooltip's text. */
  compact?: boolean;
  keys: string;
}

const APPLE = /mac|iphone|ipod|ipad|ios/i;

/** The server has no `navigator`; it draws the non-Apple names. */
const useIsAppleDevice = () =>
  useClientValue(() => APPLE.test(navigator.userAgent), false);

/** Modifier order as system menus write shortcuts. */
const MODIFIER_ORDER = ["mod", "shift"];

const modifierRank = (key: string) => {
  const rank = MODIFIER_ORDER.indexOf(key);
  return rank === -1 ? MODIFIER_ORDER.length : rank;
};

/** Modifiers first; the sort is stable, so other keys keep their order. */
const splitKeys = (keys: string) =>
  keys.split("+").sort((a, b) => modifierRank(a) - modifierRank(b));

const mappingKey = (isAppleDevice: boolean): Record<string, ReactNode> => ({
  backspace: isAppleDevice ? <Icon icon={Delete} /> : "Backspace",
  mod: isAppleDevice ? <Icon icon={Command} size="0.95em" /> : "Ctrl",
  shift: isAppleDevice ? (
    <Icon icon={ArrowBigUpIcon} size="1.15em" strokeWidth={1.75} />
  ) : (
    "Shift"
  ),
});

export function Hotkey({ compact, keys }: HotkeyProps) {
  const keysGroup = useMemo(() => splitKeys(keys), [keys]);
  const isAppleDevice = useIsAppleDevice();
  const mapping = useMemo(() => mappingKey(isAppleDevice), [isAppleDevice]);

  return (
    <Flexbox align="center" gap={2} horizontal>
      {compact ? (
        <Center as="kbd" className="ui-hotkey" gap={6} horizontal>
          {keysGroup.map((key, index) => (
            <div key={index}>{mapping[key] ?? key.toUpperCase()}</div>
          ))}
        </Center>
      ) : (
        keysGroup.map((key, index) => (
          <Center as="kbd" className="ui-hotkey" key={index}>
            {mapping[key] ?? key.toUpperCase()}
          </Center>
        ))
      )}
    </Flexbox>
  );
}
