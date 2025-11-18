import React, { useState, useEffect } from 'react';
import PropTypes from 'prop-types';

import { StudyItem } from '../StudyItem';
import { StudyBrowserSort } from '../StudyBrowserSort';
import { StudyBrowserViewOptions } from '../StudyBrowserViewOptions';

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

  const checkStudyForCases = async (studyInstanceUid: string) => {
    try {
      const isProduction = window.location.origin === 'https://view.radimal.ai';
      const isLocal = window.location.origin.includes('localhost');
      
      const apiEndpoint = isProduction
        ? 'https://reporter.radimal.ai'
        : 'https://reporter-staging.onrender.com';
      
      const apiUrl = `${apiEndpoint}/case/${studyInstanceUid}`;
      console.log(`StudyBrowser: Making API call to: ${apiUrl} (isLocal: ${isLocal}, isProduction: ${isProduction})`);
      
      const response = await fetch(apiUrl, {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' },
      });
      
      console.log(`StudyBrowser: API response status: ${response.status} for ${studyInstanceUid}`);
      
      if (!response.ok) {
        console.log(`StudyBrowser: API call failed for ${studyInstanceUid}, returning false`);
        return false;
      }
      
      const caseData = await response.json();
      console.log(`StudyBrowser: API response data for ${studyInstanceUid}:`, caseData);
      
      const hasCase = caseData?.cases?.length > 0 && 
                     caseData.cases[0]?.consultations?.length > 0;
      
      console.log(`StudyBrowser: Checked case for study ${studyInstanceUid}: ${hasCase}`);
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
      
      for (const study of tabData.studies) {
        const hasCase = await checkStudyForCases(study.studyInstanceUid);
        setStudyCaseStatusMap(prev => new Map(prev.set(study.studyInstanceUid, hasCase)));
      }
    };
    
    checkAllStudies();
  }, [tabs, activeTabName]);

  // Debug function for console testing
  const debugSetCaseStatus = (studyInstanceUid: string, hasCase: boolean) => {
    console.log(`DEBUG: Manually setting case status for ${studyInstanceUid} to ${hasCase}`);
    setStudyCaseStatusMap(prev => new Map(prev.set(studyInstanceUid, hasCase)));
  };

  React.useEffect(() => {
    if (typeof window !== 'undefined') {
      window.debugSetCaseStatus = debugSetCaseStatus;
      window.debugGetCaseStatusMap = () => {
        console.log('Current case status map:', studyCaseStatusMap);
        return studyCaseStatusMap;
      };
      window.debugGetStudyIds = () => {
        const tabData = tabs.find(tab => tab.name === activeTabName);
        const studyIds = tabData?.studies?.map(s => s.studyInstanceUid) || [];
        console.log('Available study IDs:', studyIds);
        return studyIds;
      };
    }
  }, [studyCaseStatusMap, tabs, activeTabName]);
  const getTabContent = () => {
    const tabData = tabs.find(tab => tab.name === activeTabName);
    const viewPreset = viewPresets
      ? viewPresets.filter(preset => preset.selected)[0]?.id
      : 'thumbnails';
    return tabData.studies.map(
      ({ studyInstanceUid, date, description, numInstances, modalities, displaySets }) => {
        const isExpanded = expandedStudyInstanceUIDs.includes(studyInstanceUid);
        const hasRadimalCase = studyCaseStatusMap.get(studyInstanceUid) || false;
        console.log(`StudyBrowser: Rendering study ${studyInstanceUid} hasRadimalCase:`, hasRadimalCase, 'statusMap:', studyCaseStatusMap);
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
