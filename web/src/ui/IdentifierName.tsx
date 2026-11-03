import { cloneElement, type ReactElement } from "react";

import { identifierLabel } from "../domain/identifiers/schema";
import { Tooltip } from "./kit/Tooltip";

/**
 * A thing named by its identifier: a generated one by its first eight
 * digits, whole on hover. `render` is the element that holds the name, such
 * as a link.
 */
export function IdentifierName({
  id,
  render = <span />,
}: {
  id: string;
  render?: ReactElement;
}) {
  const label = identifierLabel(id);
  const name = cloneElement(render, undefined, label);
  return label === id ? name : <Tooltip title={id}>{name}</Tooltip>;
}

/** Content digests have no generated-id prefix; twelve hex digits identify an image in a list. */
export function digestLabel(digest: string): string {
  return digest.slice(0, 12);
}
