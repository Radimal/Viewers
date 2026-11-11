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
  reporterOrigin,
  reporterFetch,
  authenticateReporter,
  openReporterReport,
  closeReporterReport,
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
                    style={{
                      pointerEvents: hasRadimalCase || !isRadimalCaseChecked ? 'auto' : 'none',
                    }}
                    onClick={async e => {
                      e.stopPropagation();
                      e.preventDefault();

                      if (isRadimalCaseChecked && !hasRadimalCase) {
                        return;
                      }

                      try {
                        if (!reporterFetch || !authenticateReporter || !reporterOrigin) {
                          throw new Error(
                            'Sign in to Radimal and reopen this study to view reports.'
                          );
                        }
                        await authenticateReporter('report');
                        const response = await reporterFetch(
                          `${reporterOrigin}/case/${encodeURIComponent(studyInstanceUid)}`
                        );
                        if (!response.ok) {
                          throw new Error('Unable to load the report for this study.');
                        }
                        const caseData = await response.json();
                        const platformUrl = caseData.platform_url;
                        const s3_url = caseData?.cases?.[0]?.consultations?.[0]?.s3_url;

                        if (s3_url) {
                          const key = s3_url.split('s3.amazonaws.com/')[1];
                          const flaskResponse = await reporterFetch(
                            `${reporterOrigin}/consultation/pdf?key=${encodeURIComponent(key)}`
                          );
                          if (!flaskResponse.ok) {
                            throw new Error('Unable to open this report.');
                          }
                          let presignedUrl = await flaskResponse.text();
                          presignedUrl = presignedUrl.trim();
                          if (presignedUrl.startsWith('"') && presignedUrl.endsWith('"')) {
                            presignedUrl = presignedUrl.slice(1, -1);
                          }
                          presignedUrl = presignedUrl.trim();

                          const consultationUrl = `${platformUrl}/consultation/?url=${encodeURIComponent(presignedUrl)}`;
                          openReporterReport(consultationUrl);
                        } else {
                          closeReporterReport?.();
                          throw new Error('No report is available for this study.');
                        }
                      } catch (error) {
                        closeReporterReport?.();
                        console.error('Error opening report:', error);
                        servicesManager?.services?.uiNotificationService?.show({
                          title: 'View Report',
                          message: error.message || 'Unable to open this report.',
                          type: 'error',
                          duration: 5000,
                        });
                      }
                    }}
                  >
                    <Icons.RadimalPdf
                      className={`h-4 w-4 transition-opacity ${
                        hasRadimalCase || !isRadimalCaseChecked
                          ? 'cursor-pointer hover:opacity-80'
                          : 'cursor-default'
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
  reporterOrigin: PropTypes.string,
  reporterFetch: PropTypes.func,
  authenticateReporter: PropTypes.func,
  openReporterReport: PropTypes.func,
  closeReporterReport: PropTypes.func,
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
