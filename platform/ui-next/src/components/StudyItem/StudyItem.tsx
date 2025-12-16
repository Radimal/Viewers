import React from 'react';
import PropTypes from 'prop-types';
import classnames from 'classnames';
import { ThumbnailList } from '../ThumbnailList';
import { Icons } from '../Icons';

import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '../Accordion';

const StudyItem = ({
  studyInstanceUid,
  date,
  description,
  numInstances,
  modalities,
  isActive,
  onClick,
  isExpanded,
  displaySets,
  activeDisplaySetInstanceUIDs,
  onClickThumbnail,
  onDoubleClickThumbnail,
  onClickUntrack,
  viewPreset = 'thumbnails',
  onThumbnailContextMenu,
  servicesManager,
  hasRadimalCase,
  isRadimalCaseChecked,
}) => {
  return (
    <Accordion
      type="single"
      collapsible
      onClick={onClick}
      onKeyDown={() => {}}
      role="button"
      tabIndex={0}
      defaultValue={isActive ? 'study-item' : undefined}
    >
      <AccordionItem value="study-item">
        <AccordionTrigger className={classnames('hover:bg-accent bg-popover rounded')}>
          <div className="flex h-[40px] flex-1 flex-row">
            <div className="flex w-full flex-row items-center justify-between">
              <div className="flex flex-col items-start text-[13px]">
                <div className="flex items-center gap-2">
                  <div className="text-white">{date}</div>
                  <div
                    className="relative z-20"
                    style={{ pointerEvents: hasRadimalCase ? 'auto' : 'none' }}
                    onClick={async e => {
                      e.stopPropagation();
                      e.preventDefault();
                      console.log('🔥 RadimalPdf icon clicked!', { studyInstanceUid, hasRadimalCase, isRadimalCaseChecked, timestamp: new Date().toISOString() });

                      if (!hasRadimalCase) {
                        console.log('No Radimal case available for this study');
                        return;
                      }

                      const origin = window.location.origin;
                      let apiEndpoint;

                      if (origin === 'http://localhost:3000') {
                        apiEndpoint = 'http://localhost:5007';
                      } else if (origin === 'https://viewer.stage-1.radimal.ai') {
                        apiEndpoint = 'https://reporter-staging.onrender.com';
                      } else if (origin === 'https://view.radimal.ai') {
                        apiEndpoint = 'https://radimal-reporter.onrender.com';
                      } else {
                        apiEndpoint = 'https://radimal-reporter.onrender.com';
                      }

                      try {
                        const response = await fetch(`${apiEndpoint}/case/${studyInstanceUid}`);
                        const caseData = await response.json();
                        const platformUrl = caseData.platform_url;
                        const s3_url = caseData.cases[0].consultations[0].s3_url;

                        if (s3_url) {
                          const key = s3_url.split('s3.amazonaws.com/')[1];
                          const flaskResponse = await fetch(
                            `${apiEndpoint}/consultation/pdf?key=${key}`
                          );
                          let presignedUrl = await flaskResponse.text();
                          presignedUrl = presignedUrl.trim();
                          if (presignedUrl.startsWith('"') && presignedUrl.endsWith('"')) {
                            presignedUrl = presignedUrl.slice(1, -1);
                          }
                          presignedUrl = presignedUrl.trim();

                          const consultationUrl = `${platformUrl}/consultation/?url=${encodeURIComponent(presignedUrl)}`;
                          window.open(consultationUrl, '_blank');
                        }
                      } catch (error) {
                        console.error('Error opening report:', error);
                      }
                    }}
                  >
                    <Icons.RadimalPdf
                      className={`h-4 w-4 transition-opacity ${
                        hasRadimalCase ? 'cursor-pointer hover:opacity-80' : 'cursor-default'
                      }`}
                      hasCase={hasRadimalCase}
                      isChecked={isRadimalCaseChecked}
                    />
                  </div>
                </div>
                <div className="text-muted-foreground h-[18px] max-w-[160px] overflow-hidden truncate whitespace-nowrap">
                  {description}
                </div>
              </div>
              <div className="text-muted-foreground mr-2 flex flex-col items-end text-[12px]">
                <div className="max-w-[150px] overflow-hidden text-ellipsis">{modalities}</div>
                <div>{numInstances}</div>
              </div>
            </div>
          </div>
        </AccordionTrigger>
        <AccordionContent
          onClick={event => {
            event.stopPropagation();
          }}
        >
          {isExpanded && displaySets && (
            <ThumbnailList
              studyInstanceUid={studyInstanceUid}
              thumbnails={displaySets}
              activeDisplaySetInstanceUIDs={activeDisplaySetInstanceUIDs}
              onThumbnailClick={onClickThumbnail}
              onThumbnailDoubleClick={onDoubleClickThumbnail}
              onClickUntrack={onClickUntrack}
              viewPreset={viewPreset}
              onThumbnailContextMenu={onThumbnailContextMenu}
              servicesManager={servicesManager}
              hasRadimalCase={hasRadimalCase}
              isRadimalCaseChecked={isRadimalCaseChecked}
            />
          )}
        </AccordionContent>
      </AccordionItem>
    </Accordion>
  );
};

StudyItem.propTypes = {
  studyInstanceUid: PropTypes.string,
  date: PropTypes.string.isRequired,
  description: PropTypes.string,
  modalities: PropTypes.string.isRequired,
  numInstances: PropTypes.number.isRequired,
  trackedSeries: PropTypes.number,
  isActive: PropTypes.bool,
  onClick: PropTypes.func.isRequired,
  isExpanded: PropTypes.bool,
  displaySets: PropTypes.array,
  activeDisplaySetInstanceUIDs: PropTypes.array,
  onClickThumbnail: PropTypes.func,
  onDoubleClickThumbnail: PropTypes.func,
  onClickUntrack: PropTypes.func,
  viewPreset: PropTypes.string,
  hasRadimalCase: PropTypes.bool,
  isRadimalCaseChecked: PropTypes.bool,
  servicesManager: PropTypes.object,
};

export { StudyItem };
