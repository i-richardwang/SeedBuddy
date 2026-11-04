import { Check, Copy } from "lucide-react";
import { useEffect, useState } from "react";

import { m } from "../../paraglide/messages";
import { ActionIcon } from "./ActionIcon";
import { toast } from "./Toast";

/*
 * Writes `content` to the clipboard on press, then shows a check for a
 * moment. `title` names what is copied when "Copy" alone would not.
 */

const COPIED_MS = 2000;

export function CopyButton({
  content,
  title = m.ui_copy_button_copy(),
}: {
  content: string;
  title?: string;
}) {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => setCopied(false), COPIED_MS);
    return () => window.clearTimeout(timer);
  }, [copied]);

  return (
    <ActionIcon
      title={title}
      size="small"
      icon={copied ? Check : Copy}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(content);
        } catch {
          toast.error(m.ui_text_not_copied());
          return;
        }
        setCopied(true);
      }}
    />
  );
}
