import type { ReactNode } from "react";

/* The product's mark in white on a tile of the brand's greens, 40px. */
export function LogoTile({ children }: { children: ReactNode }) {
  return (
    <span aria-hidden className="ui-logo-tile">
      {children}
    </span>
  );
}
