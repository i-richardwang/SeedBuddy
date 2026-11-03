import { Switch as BaseSwitch } from "@base-ui/react/switch";
import { animate, motionValue } from "motion";
import {
  type CSSProperties,
  type KeyboardEvent,
  useEffect,
  useRef,
  useState,
} from "react";

import { cn } from "./cn";
import { springTransition } from "./motionToken";

/*
 * A controlled switch. The thumb stretches while pressed and springs to its
 * place. Its geometry lives in Switch.css; two motion values from 0 to 1, how
 * far it has travelled and how far it is stretched, are written straight to
 * the element as `--ui-switch-on` and `--ui-switch-stretch`, so React never
 * rewrites them mid-flight.
 */

export type SwitchSize = "middle" | "small";

const THUMB_SPRING = { damping: 24, stiffness: 360 };

const SIZE = {
  middle: "ui-switch-middle",
  small: "ui-switch-small",
} as const;

function SwitchThumb({
  checked,
  pressed,
}: {
  checked: boolean;
  pressed: boolean;
}) {
  const ref = useRef<HTMLSpanElement>(null);
  const on = checked ? 1 : 0;
  const stretch = pressed ? 1 : 0;

  const [values] = useState(() => ({
    on: motionValue(on),
    stretch: motionValue(stretch),
  }));

  const [initialStyle] = useState(
    () =>
      ({
        "--ui-switch-on": on,
        "--ui-switch-stretch": stretch,
      }) as CSSProperties,
  );

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const unsubscribeOn = values.on.on("change", (value) => {
      el.style.setProperty("--ui-switch-on", String(value));
    });
    const unsubscribeStretch = values.stretch.on("change", (value) => {
      el.style.setProperty("--ui-switch-stretch", String(value));
    });
    return () => {
      unsubscribeOn();
      unsubscribeStretch();
    };
  }, [values]);

  useEffect(() => {
    const transition = springTransition(THUMB_SPRING);
    const animations = [
      animate(values.on, on, transition),
      animate(values.stretch, stretch, transition),
    ];
    return () => {
      for (const animation of animations) animation.stop();
    };
  }, [values, on, stretch]);

  return (
    <BaseSwitch.Thumb
      render={
        <span className="ui-switch-thumb" ref={ref} style={initialStyle} />
      }
    />
  );
}

export interface SwitchProps {
  checked: boolean;
  disabled?: boolean;
  onChange: (checked: boolean) => void;
  size?: SwitchSize;
}

export function Switch({
  checked,
  disabled,
  onChange,
  size = "middle",
}: SwitchProps) {
  const [pressed, setPressed] = useState(false);
  const press = () => {
    if (!disabled) setPressed(true);
  };
  const release = () => setPressed(false);

  return (
    <BaseSwitch.Root
      nativeButton
      checked={checked}
      disabled={disabled}
      render={
        <button
          className={cn("ui-switch", SIZE[size])}
          type="button"
          onKeyDown={(event: KeyboardEvent) => {
            if (event.key === " ") press();
          }}
          onKeyUp={(event: KeyboardEvent) => {
            if (event.key === " ") release();
          }}
          onPointerCancel={release}
          onPointerDown={press}
          onPointerLeave={release}
          onPointerUp={release}
        />
      }
      onCheckedChange={(next) => onChange(next)}
    >
      <SwitchThumb checked={checked} pressed={pressed} />
    </BaseSwitch.Root>
  );
}
