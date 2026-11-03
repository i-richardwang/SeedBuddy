import { m } from "../paraglide/messages";
import type { Locale } from "../paraglide/runtime";

const LOCALE_NAMES: Record<Locale, () => string> = {
  en: m.account_language_en,
  "zh-CN": m.account_language_zh_cn,
};

export function localeLabel(locale: Locale): string {
  return LOCALE_NAMES[locale]();
}
