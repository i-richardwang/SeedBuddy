import { FileArchive, LoaderCircle } from "lucide-react";
import { useState } from "react";

import { m } from "../../paraglide/messages";
import { FormDialog } from "../../ui/FormDialog";
import {
  type AsyncAction,
  useAsyncAction,
} from "../../ui/hooks/useAsyncAction";
import { useNavigateAfterWrite } from "../../ui/hooks/useNavigateAfterWrite";
import { DropZone } from "../../ui/kit/DropZone";
import { Icon } from "../../ui/kit/Icon";
import { Progress } from "../../ui/kit/Progress";
import { Text } from "../../ui/kit/Text";
import { type ImportProgress, importDatasetArchive } from "./import-archive";

export function ImportDatasetDialog({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const action = useAsyncAction();
  return (
    <FormDialog
      open={open}
      onClose={onClose}
      title={m.dataset_import_heading()}
      busy={action.busy}
    >
      <ImportArchiveForm action={action} onDone={onClose} />
    </FormDialog>
  );
}

/**
 * Starts the import as soon as an archive is dropped or chosen; its progress
 * stays on screen until the dialog has closed on the imported dataset.
 */
function ImportArchiveForm({
  action: { run },
  onDone,
}: {
  action: AsyncAction;
  onDone: () => void;
}) {
  const navigateAfterWrite = useNavigateAfterWrite();
  const [progress, setProgress] = useState<ImportProgress | null>(null);

  const importArchive = (file: File) =>
    void run(
      () => importDatasetArchive(file, setProgress),
      m.dataset_import_failed(),
      {
        invalidate: false,
        onSuccess: async (dataset) => {
          onDone();
          await navigateAfterWrite({
            to: "/datasets/$dataset",
            params: { dataset: dataset.id },
          });
        },
      },
    ).then((result) => {
      if (!result.ok) {
        setProgress(null);
      }
    });

  return progress ? (
    <ImportProgressPanel progress={progress} />
  ) : (
    <DropZone
      accept=".zip,application/zip"
      multiple={false}
      icon={FileArchive}
      title={m.dataset_import_drop_label()}
      description={m.dataset_import_drop_description()}
      selectText={m.dataset_import_select()}
      onFiles={([file]) => {
        if (file) importArchive(file);
      }}
    />
  );
}

/** Occupies the drop zone's place while the archive is read and its images stored. */
function ImportProgressPanel({ progress }: { progress: ImportProgress }) {
  const total =
    progress.phase === "reading" ? 0 : progress.manifest.images.length;
  return (
    <div
      aria-live="polite"
      className="flex min-h-40 flex-col justify-center gap-3"
    >
      <Text size="sm" className="flex items-center justify-between gap-3">
        <span className="flex min-w-0 items-center gap-2">
          <Text as="span" type="tertiary" className="flex">
            <Icon icon={LoaderCircle} size={14} spin />
          </Text>
          {progress.phase === "reading" ? (
            m.dataset_import_reading()
          ) : (
            <span className="truncate">
              {m.dataset_import_storing({
                dataset: progress.manifest.dataset,
              })}
            </span>
          )}
        </span>
        {progress.phase === "reading" ? null : (
          <Text as="span" type="secondary" className="shrink-0 tabular-nums">
            {m.dataset_import_storing_count({ stored: progress.stored, total })}
          </Text>
        )}
      </Text>
      <Progress
        aria-label={m.dataset_import_progress()}
        value={progress.phase === "reading" ? 0 : progress.stored}
        max={Math.max(total, 1)}
      />
    </div>
  );
}
