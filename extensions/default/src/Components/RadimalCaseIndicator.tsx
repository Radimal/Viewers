import React, { useEffect, useSyncExternalStore } from 'react';
import { useSystem } from '@ohif/core';
import { RadimalPdf } from '../icons/radimalIcons';
import { ensureCaseStatus, hasCase, subscribeCaseStatus } from '../utils/radimalCaseStatus';

/**
 * Radimal: always-visible one-click PDF affordance on the study row.
 * Unknown status keeps the action available so a standalone user can sign in.
 * A confirmed missing report hides it.
 */
function RadimalCaseIndicator({ StudyInstanceUID }: { StudyInstanceUID: string }) {
  const { commandsManager } = useSystem();

  const studyHasCase = useSyncExternalStore(subscribeCaseStatus, () => hasCase(StudyInstanceUID));

  useEffect(() => {
    ensureCaseStatus(StudyInstanceUID);
  }, [StudyInstanceUID]);

  if (studyHasCase === false) {
    return null;
  }

  return (
    <div
      className="cursor-pointer"
      data-cy="radimal-case-indicator"
      title="View Report"
      onClick={event => {
        // Don't toggle the study accordion.
        event.stopPropagation();
        commandsManager.run('viewReport', { StudyInstanceUID });
      }}
    >
      <RadimalPdf />
    </div>
  );
}

export default RadimalCaseIndicator;
