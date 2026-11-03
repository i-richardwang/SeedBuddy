import { Tooltip as BaseTooltip } from "@base-ui/react/tooltip";
import {
  cloneElement,
  createContext,
  type ReactElement,
  type ReactNode,
  type Ref,
  use,
  useCallback,
  useEffect,
  useState,
} from "react";

import { defaultPortalContainer, triggerRender } from "./floating";
import { Hotkey } from "./Hotkey";
import {
  useDestroyOnLostTrigger,
  useMarkPositionerAtOrigin,
  usePopupHandleStore,
  useRepopOnFarSwitch,
} from "./popupHandle";

/*
 * With neither `title` nor `hotkey`, children are returned as is. The trigger
 * is a single element whose props and ref merge into it, with no extra
 * wrapper (see floating.ts). A disabled control takes no pointer events, so
 * it is wrapped in a span that hosts the tooltip and can say why it is
 * disabled. Each tooltip has one trigger.
 *
 * Inside a `TooltipGroup` the triggers share one popup: once it is open,
 * moving to a neighbour shows that one's text without the opening delay.
 *
 * `OverflowTooltip` is for a name cut to one line with an ellipsis: it shows
 * the whole name only while the child's box is cutting it.
 */

const OPEN_DELAY = 400;
const CLOSE_DELAY = 100;

/** The side of the trigger the tooltip sits on, centered along it. */
type TooltipPlacement = "top" | "right" | "bottom";

export interface TooltipProps {
  children: ReactElement;
  /** The trigger stays in place and the tooltip does not open. */
  disabled?: boolean;
  /** Written like Hotkey's `keys` (`mod+k`). */
  hotkey?: string;
  placement?: TooltipPlacement;
  title?: ReactNode;
}

type TooltipItem = Pick<TooltipProps, "hotkey" | "placement" | "title">;

type TooltipHandle = ReturnType<typeof BaseTooltip.createHandle<TooltipItem>>;

const TooltipGroupContext = createContext<TooltipHandle | null>(null);

function TooltipContent({ hotkey, title }: TooltipItem) {
  return (
    <>
      {title}
      {hotkey ? <Hotkey compact keys={hotkey} /> : null}
    </>
  );
}

export function Tooltip({
  children,
  disabled,
  title,
  hotkey,
  placement = "top",
}: TooltipProps) {
  const group = use(TooltipGroupContext);
  if (title == null && !hotkey) return children;

  const child = children as ReactElement<Record<string, unknown>>;
  // When the child is itself a popup trigger (aria-haspopup with an id), the tooltip trigger keeps that id.
  const popupTriggerId =
    child.props["aria-haspopup"] !== undefined &&
    typeof child.props.id === "string"
      ? child.props.id
      : undefined;
  const render = child.props.disabled ? (
    <span className="ui-tooltip-disabled-trigger">{children}</span>
  ) : (
    triggerRender(children)
  );

  if (group) {
    return (
      <BaseTooltip.Trigger
        closeDelay={CLOSE_DELAY}
        delay={OPEN_DELAY}
        disabled={disabled}
        handle={group}
        id={popupTriggerId}
        payload={{ hotkey, placement, title }}
        render={render}
      />
    );
  }

  return (
    <BaseTooltip.Root disabled={disabled}>
      <BaseTooltip.Trigger
        closeDelay={CLOSE_DELAY}
        delay={OPEN_DELAY}
        id={popupTriggerId}
        render={render}
      />
      <BaseTooltip.Portal container={defaultPortalContainer()}>
        <BaseTooltip.Positioner
          className="ui-tooltip-positioner"
          data-placement={placement}
          side={placement}
          sideOffset={6}
        >
          <BaseTooltip.Popup className="ui-tooltip-popup">
            <BaseTooltip.Viewport className="ui-tooltip-viewport">
              <TooltipContent hotkey={hotkey} title={title} />
            </BaseTooltip.Viewport>
          </BaseTooltip.Popup>
        </BaseTooltip.Positioner>
      </BaseTooltip.Portal>
    </BaseTooltip.Root>
  );
}

export function OverflowTooltip({
  children,
  placement,
  title,
}: {
  /** The element whose own box cuts the text. */
  children: ReactElement;
  placement?: TooltipPlacement;
  title: string;
}) {
  const [node, setNode] = useState<HTMLElement | null>(null);
  const [cut, setCut] = useState(false);

  useEffect(() => {
    if (!node) return;
    const measure = () => setCut(node.scrollWidth > node.clientWidth);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => observer.disconnect();
  }, [node, title]);

  return (
    <Tooltip disabled={!cut} placement={placement} title={title}>
      {cloneElement(children as ReactElement<{ ref?: Ref<HTMLElement> }>, {
        ref: setNode,
      })}
    </Tooltip>
  );
}

/**
 * One popup for every `Tooltip` inside. With `layoutAnimation` it glides
 * from trigger to trigger, its box morphing while the old text and the new
 * crossfade, which suits controls that stand together, as in a toolbar;
 * across more than 280px it reappears at the new trigger instead. Without,
 * it only skips the opening delay, which suits a whole page. A group inside
 * another takes over its own tooltips.
 */
export function TooltipGroup({
  children,
  layoutAnimation = true,
}: {
  children: ReactNode;
  layoutAnimation?: boolean;
}) {
  const [{ handle, key }, setHandle] = useState(() => ({
    handle: BaseTooltip.createHandle<TooltipItem>(),
    key: 0,
  }));
  const destroy = useCallback(() => {
    setHandle(({ key }) => ({
      handle: BaseTooltip.createHandle<TooltipItem>(),
      key: key + 1,
    }));
  }, []);

  const store = usePopupHandleStore(handle);
  useDestroyOnLostTrigger(store, destroy);
  useMarkPositionerAtOrigin(store);
  const repop = useRepopOnFarSwitch(store, layoutAnimation) || undefined;
  const animated = layoutAnimation || undefined;

  return (
    <TooltipGroupContext value={handle}>
      {/* The children stand outside Root: a new handle remounts Root, and they must outlive it. */}
      {children}
      <BaseTooltip.Root handle={handle} key={key}>
        {({ payload }) => {
          const item = payload as TooltipItem | undefined;
          if (!item) return null;
          const placement = item.placement ?? "top";
          return (
            <BaseTooltip.Portal container={defaultPortalContainer()}>
              <BaseTooltip.Positioner
                className="ui-tooltip-positioner"
                data-layout-animation={animated}
                data-placement={placement}
                data-repop={repop}
                side={placement}
                sideOffset={6}
              >
                <BaseTooltip.Popup
                  className="ui-tooltip-popup"
                  data-layout-animation={animated}
                  data-repop={repop}
                >
                  <BaseTooltip.Viewport
                    className="ui-tooltip-viewport"
                    data-repop={repop}
                  >
                    <TooltipContent hotkey={item.hotkey} title={item.title} />
                  </BaseTooltip.Viewport>
                </BaseTooltip.Popup>
              </BaseTooltip.Positioner>
            </BaseTooltip.Portal>
          );
        }}
      </BaseTooltip.Root>
    </TooltipGroupContext>
  );
}
