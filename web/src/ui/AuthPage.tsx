import type { ComponentProps } from "react";

import { AppBrand } from "./BrandLogo";
import { AuthLayout, AuthLayoutSeparator } from "./kit/AuthLayout";
import { ColorSchemeMenu, LanguageMenu } from "./preferences";

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
          <AuthLayoutSeparator />
          <ColorSchemeMenu />
        </div>
      }
    />
  );
}
