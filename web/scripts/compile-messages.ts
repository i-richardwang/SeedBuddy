import { compile } from "@inlang/paraglide-js";

import { paraglideOptions } from "../paraglide.config";

export async function compileMessages(): Promise<void> {
  await compile(paraglideOptions);
}
