import { Icon, type IconProps } from "./Icon";

/*
 * An icon on a rounded tile that marks what kind of thing a card stands for.
 * At 40px (glyph 22), it leads a summary card in the info color on its fill.
 */
export function IconTile({ icon }: { icon: IconProps["icon"] }) {
  return (
    <span aria-hidden className="ui-icon-tile">
      <Icon icon={icon} size={22} />
    </span>
  );
}
