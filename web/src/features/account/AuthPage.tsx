import type { ComponentProps } from "react";

import { AppBrand } from "../../ui/BrandLogo";
import { AuthLayout } from "../../ui/kit/AuthLayout";
import { ColorSchemeMenu, LanguageMenu } from "../../ui/Preferences";

/** A page outside the signed-in shell: the brand above, the language and color scheme below. */
export function AuthPage(
  props: Omit<ComponentProps<typeof AuthLayout>, "brand" | "footer">,
) {
  return (
    <AuthLayout
      {...props}
      brand={<AppBrand />}
      footer={
        <div className="flex items-center gap-2">
          <LanguageMenu />
          <span aria-hidden className="h-6 w-px bg-border-secondary" />
          <ColorSchemeMenu />
        </div>
      }
    />
  );
}
