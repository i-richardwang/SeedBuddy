import { Check, Globe, Monitor, Moon, Sun } from "lucide-react";

import { m } from "../paraglide/messages";
import {
  getLocale,
  type Locale,
  locales,
  setLocale,
} from "../paraglide/runtime";
import {
  type ColorScheme,
  setColorScheme,
  useColorScheme,
} from "./colorScheme";
import { ActionIcon, type ActionIconProps } from "./kit/ActionIcon";
import { Button } from "./kit/Button";
import { DropdownMenu } from "./kit/DropdownMenu";
import { Select } from "./kit/Select";
import { Text } from "./kit/Text";
import { localeLabel } from "./labels";

/*
 * The reader's language and color scheme, as quiet menus for the footer of
 * a page outside the signed-in shell and as selects for the account page.
 * Choosing a language stores the locale cookie and reloads, so the server
 * renders the next document in that language.
 */

const SCHEMES: { value: ColorScheme; icon: typeof Sun; label: () => string }[] =
  [
    { value: "system", icon: Monitor, label: m.account_color_scheme_system },
    { value: "light", icon: Sun, label: m.account_color_scheme_light },
    { value: "dark", icon: Moon, label: m.account_color_scheme_dark },
  ];

function chooseLocale(locale: Locale) {
  if (locale !== getLocale()) void setLocale(locale);
}

/** A text button naming the current language, opening the list of languages. */
export function LanguageMenu() {
  const current = getLocale();
  return (
    <DropdownMenu
      items={locales.map((locale) => ({
        key: locale,
        label: localeLabel(locale),
        icon: locale === current ? Check : undefined,
        onClick: () => chooseLocale(locale),
      }))}
    >
      <Button
        aria-label={m.account_language()}
        icon={Globe}
        iconPosition="end"
        type="text"
      >
        <Text as="span" size="xs">
          {localeLabel(current)}
        </Text>
      </Button>
    </DropdownMenu>
  );
}

/** An icon button showing the current color scheme, opening the choices. */
export function ColorSchemeMenu({ size }: { size?: ActionIconProps["size"] }) {
  const scheme = useColorScheme();
  const current = SCHEMES.find((each) => each.value === scheme)!;
  return (
    <DropdownMenu
      items={SCHEMES.map((each) => ({
        key: each.value,
        label: each.label(),
        icon: each.icon,
        onClick: () => setColorScheme(each.value),
      }))}
    >
      <ActionIcon
        icon={current.icon}
        size={size}
        title={m.account_color_scheme()}
      />
    </DropdownMenu>
  );
}

export function LanguageSelect({
  "aria-label": ariaLabel,
}: {
  "aria-label": string;
}) {
  return (
    <Select<Locale>
      aria-label={ariaLabel}
      value={getLocale()}
      options={locales.map((locale) => ({
        value: locale,
        label: localeLabel(locale),
      }))}
      onChange={chooseLocale}
    />
  );
}

export function ColorSchemeSelect({
  "aria-label": ariaLabel,
}: {
  "aria-label": string;
}) {
  const scheme = useColorScheme();
  return (
    <Select<ColorScheme>
      aria-label={ariaLabel}
      value={scheme}
      options={SCHEMES.map((each) => ({
        value: each.value,
        label: each.label(),
      }))}
      onChange={setColorScheme}
    />
  );
}
