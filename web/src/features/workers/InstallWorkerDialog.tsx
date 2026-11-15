import { m } from "../../paraglide/messages";
import { CopyableCode } from "../../ui/CopyableCode";
import { Modal } from "../../ui/kit/Modal";
import { Text } from "../../ui/kit/Text";

/**
 * The command that installs `seedctl` on a Worker from the package this
 * workbench ships, or updates it after the workbench has; a workbench that
 * ships none says so.
 */
export function InstallWorkerDialog({
  command,
  open,
  onClose,
}: {
  command: string | null;
  open: boolean;
  onClose: () => void;
}) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={m.worker_install_title()}
      footer={null}
    >
      {command === null ? (
        <Text type="secondary">{m.worker_install_unavailable()}</Text>
      ) : (
        <CopyableCode
          value={command}
          label={m.worker_install_command_label()}
          description={m.worker_install_command_description()}
        />
      )}
    </Modal>
  );
}
