import type { DependencyInstallError, DependencyUninstallError } from '@shared/dependencies';
import type { RuntimeId } from '@shared/runtime-registry';
import { agentConfig } from '@renderer/utils/agentConfig';

export type AgentInstallActionState = {
  render: boolean;
  disabled: boolean;
  installing: boolean;
  label: string;
};

export function getAgentInstallErrorMessage(error: DependencyInstallError): string {
  switch (error.type) {
    case 'permission-denied':
      return error.message;
    case 'command-failed':
      return error.output ? `${error.message} ${error.output}` : error.message;
    case 'pty-open-failed':
      return error.message;
    case 'unknown-dependency':
      return `Unknown dependency: ${error.id}`;
    case 'no-install-command':
      return `No install command is available for ${error.id}.`;
    case 'not-detected-after-install':
      return 'The agent was not detected after installation.';
  }
}

export function getAgentUninstallErrorMessage(error: DependencyUninstallError): string {
  switch (error.type) {
    case 'permission-denied':
      return error.message;
    case 'command-failed':
      return error.output ? `${error.message} ${error.output}` : error.message;
    case 'pty-open-failed':
      return error.message;
    case 'unknown-dependency':
      return `Unknown dependency: ${error.id}`;
    case 'no-uninstall-command':
      return `No safe uninstall command is available for ${error.id}.`;
    case 'still-detected-after-uninstall':
      return 'The agent is still detected after uninstalling.';
  }
}

export function getAgentInstallActionState({
  agentId,
  canInstall,
  isInstalled,
  isInstalling,
}: {
  agentId: RuntimeId;
  canInstall: boolean;
  isInstalled: boolean;
  isInstalling: boolean;
}): AgentInstallActionState {
  return {
    render: canInstall && !isInstalled,
    disabled: isInstalling,
    installing: isInstalling,
    label: `Install ${agentConfig[agentId].name}`,
  };
}
