import React, { useState, useEffect } from 'react';
import PropTypes from 'prop-types';

import { StudyItem } from '../StudyItem';
import { StudyBrowserSort } from '../StudyBrowserSort';
import { StudyBrowserViewOptions } from '../StudyBrowserViewOptions';
import { reporterOriginFor } from '../../lib/reporterOrigin';

const getTrackedSeries = displaySets => {
  let trackedSeries = 0;
  displaySets.forEach(displaySet => {
    if (displaySet.isTracked) {
      trackedSeries++;
    }
  });

  return trackedSeries;
};

const noop = () => {};

const StudyBrowser = ({
  tabs,
  activeTabName,
  expandedStudyInstanceUIDs,
  onClickTab = noop,
  onClickStudy = noop,
  onClickThumbnail = noop,
  onDoubleClickThumbnail = noop,
  onClickUntrack = noop,
  activeDisplaySetInstanceUIDs,
  servicesManager,
  showSettings,
  viewPresets,
  onThumbnailContextMenu,
}) => {
  const [studyCaseStatusMap, setStudyCaseStatusMap] = useState<Map<string, boolean>>(new Map());
  const [checkedStudies, setCheckedStudies] = useState<Set<string>>(new Set());

  const checkStudyForCases = async (studyInstanceUid: string) => {
    try {
      const apiEndpoint = reporterOriginFor(window.location.origin);

      const apiUrl = `${apiEndpoint}/case/${studyInstanceUid}`;

      const response = await fetch(apiUrl, {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' },
      });

      if (!response.ok) {
        return false;
      }

      const caseData = await response.json();

      const hasCase =
        caseData?.cases?.length > 0 &&
        caseData.cases[0]?.consultations?.length > 0 &&
        caseData.cases[0]?.consultations[0]?.s3_url;

      return hasCase;
    } catch (error) {
      console.error(`StudyBrowser: Error checking case for ${studyInstanceUid}:`, error);
      return false;
    }
  };

  // Check cases when studies load
  React.useEffect(() => {
    const checkAllStudies = async () => {
      const tabData = tabs.find(tab => tab.name === activeTabName);
      if (!tabData?.studies) return;

      // Filter out studies we've already checked
      const studiesToCheck = tabData.studies.filter(
        study => !checkedStudies.has(study.studyInstanceUid)
      );

      if (studiesToCheck.length === 0) {
        return;
      }

      // Then check each study and update the map
      for (const study of studiesToCheck) {
        try {
          const hasCase = await checkStudyForCases(study.studyInstanceUid);

          setStudyCaseStatusMap(prev => new Map(prev.set(study.studyInstanceUid, hasCase)));

          setCheckedStudies(prev => new Set(prev.add(study.studyInstanceUid)));
        } catch (error) {
          setCheckedStudies(prev => new Set(prev.add(study.studyInstanceUid)));
        }
      }
    };

    checkAllStudies();
  }, [tabs, activeTabName]);

  // Debug function for console testing
  const debugSetCaseStatus = (studyInstanceUid: string, hasCase: boolean) => {
    setStudyCaseStatusMap(prev => new Map(prev.set(studyInstanceUid, hasCase)));
    setCheckedStudies(prev => new Set(prev.add(studyInstanceUid)));
  };

  const debugClearCache = () => {
    setStudyCaseStatusMap(new Map());
    setCheckedStudies(new Set());
  };

  React.useEffect(() => {
    if (typeof window !== 'undefined') {
      window.debugSetCaseStatus = debugSetCaseStatus;
      window.debugClearCache = debugClearCache;
      // DevTools handles: they return their value, so the caller sees it in the
      // console without us logging on every render.
      window.debugGetCaseStatusMap = () => studyCaseStatusMap;
      window.debugGetCheckedStudies = () => checkedStudies;
      window.debugGetStudyIds = () => {
        const tabData = tabs.find(tab => tab.name === activeTabName);
        return tabData?.studies?.map(s => s.studyInstanceUid) || [];
      };
    }
  }, [studyCaseStatusMap, checkedStudies, tabs, activeTabName]);
  const getTabContent = () => {
    const tabData = tabs.find(tab => tab.name === activeTabName);
    const viewPreset = viewPresets
      ? viewPresets.filter(preset => preset.selected)[0]?.id
      : 'thumbnails';
    return tabData.studies.map(
      ({ studyInstanceUid, date, description, numInstances, modalities, displaySets }) => {
        const isExpanded = expandedStudyInstanceUIDs.includes(studyInstanceUid);
        const hasRadimalCase = studyCaseStatusMap.get(studyInstanceUid) ?? false;
        const isChecked = checkedStudies.has(studyInstanceUid);
        return (
          <React.Fragment key={studyInstanceUid}>
            <StudyItem
              studyInstanceUid={studyInstanceUid}
              date={date}
              description={description}
              numInstances={numInstances}
              isExpanded={isExpanded}
              displaySets={displaySets}
              modalities={modalities}
              trackedSeries={getTrackedSeries(displaySets)}
              isActive={isExpanded}
              onClick={() => {
                onClickStudy(studyInstanceUid);
              }}
              onClickThumbnail={onClickThumbnail}
              onDoubleClickThumbnail={onDoubleClickThumbnail}
              onClickUntrack={onClickUntrack}
              activeDisplaySetInstanceUIDs={activeDisplaySetInstanceUIDs}
              data-cy="thumbnail-list"
              viewPreset={viewPreset}
              onThumbnailContextMenu={onThumbnailContextMenu}
              servicesManager={servicesManager}
              hasRadimalCase={hasRadimalCase}
              isRadimalCaseChecked={isChecked}
            />
          </React.Fragment>
        );
      }
    );
  };

  return (
    <div
      className="ohif-scrollbar invisible-scrollbar bg-bkg-low flex flex-1 flex-col gap-[4px] overflow-auto"
      data-cy={'studyBrowser-panel'}
    >
      <div>
        <div className="w-100 bg-bkg-low flex h-[48px] items-center justify-center gap-[10px] px-[8px] py-[10px]">
          <>
            <StudyBrowserViewOptions
              tabs={tabs}
              onSelectTab={onClickTab}
              activeTabName={activeTabName}
            />
            <StudyBrowserSort servicesManager={servicesManager} />
          </>
        </div>
        {getTabContent()}
      </div>
    </div>
  );
};

StudyBrowser.propTypes = {
  onClickTab: PropTypes.func.isRequired,
  onClickStudy: PropTypes.func,
  onClickThumbnail: PropTypes.func,
  onDoubleClickThumbnail: PropTypes.func,
  onClickUntrack: PropTypes.func,
  activeTabName: PropTypes.string.isRequired,
  expandedStudyInstanceUIDs: PropTypes.arrayOf(PropTypes.string).isRequired,
  activeDisplaySetInstanceUIDs: PropTypes.arrayOf(PropTypes.string),
  tabs: PropTypes.arrayOf(
    PropTypes.shape({
      name: PropTypes.string.isRequired,
      label: PropTypes.string.isRequired,
      studies: PropTypes.arrayOf(
        PropTypes.shape({
          studyInstanceUid: PropTypes.string.isRequired,
          date: PropTypes.string,
          numInstances: PropTypes.number,
          modalities: PropTypes.string,
          description: PropTypes.string,
          displaySets: PropTypes.arrayOf(
            PropTypes.shape({
              displaySetInstanceUID: PropTypes.string.isRequired,
              imageSrc: PropTypes.string,
              imageAltText: PropTypes.string,
              seriesDate: PropTypes.string,
              seriesNumber: PropTypes.any,
              numInstances: PropTypes.number,
              description: PropTypes.string,
              componentType: PropTypes.oneOf(['thumbnail', 'thumbnailTracked', 'thumbnailNoImage'])
                .isRequired,
              isTracked: PropTypes.bool,
              /**
               * Data the thumbnail should expose to a receiving drop target. Use a matching
               * `dragData.type` to identify which targets can receive this draggable item.
               * If this is not set, drag-n-drop will be disabled for this thumbnail.
               *
               * Ref: https://react-dnd.github.io/react-dnd/docs/api/use-drag#specification-object-members
               */
              dragData: PropTypes.shape({
                /** Must match the "type" a dropTarget expects */
                type: PropTypes.string.isRequired,
              }),
            })
          ),
        })
      ).isRequired,
    })
  ),
};

export { StudyBrowser };
