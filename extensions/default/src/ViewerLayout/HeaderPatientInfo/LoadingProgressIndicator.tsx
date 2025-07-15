import React, { useState, useEffect } from 'react';

interface LoadingProgressIndicatorProps {
  servicesManager: any;
}

interface LoadingState {
  isLoading: boolean;
  progress: number;
  displaySetInstanceUID?: string;
}

function LoadingProgressIndicator({ servicesManager }: LoadingProgressIndicatorProps) {
  const [loadingState, setLoadingState] = useState<LoadingState>({
    isLoading: false,
    progress: 0,
  });

  useEffect(() => {
    const { studyPrefetcherService, viewportGridService } = servicesManager.services;

    const progressSubscription = studyPrefetcherService.subscribe(
      studyPrefetcherService.EVENTS.DISPLAYSET_LOAD_PROGRESS,
      ({ displaySetInstanceUID, loadingProgress }) => {
        const viewportGridState = viewportGridService.getState();
        const activeViewport = viewportGridState.viewports.get(viewportGridState.activeViewportId);
        
        if (activeViewport?.displaySetInstanceUIDs?.includes(displaySetInstanceUID)) {
          setLoadingState({
            isLoading: loadingProgress < 1,
            progress: Math.round(loadingProgress * 100),
            displaySetInstanceUID,
          });
        }
      }
    );

    const completeSubscription = studyPrefetcherService.subscribe(
      studyPrefetcherService.EVENTS.DISPLAYSET_LOAD_COMPLETE,
      ({ displaySetInstanceUID }) => {
        setLoadingState(prev => {
          if (prev.displaySetInstanceUID === displaySetInstanceUID) {
            return {
              isLoading: false,
              progress: 100,
            };
          }
          return prev;
        });
      }
    );

    const viewportChangeSubscription = viewportGridService.subscribe(
      viewportGridService.EVENTS.ACTIVE_VIEWPORT_ID_CHANGED,
      () => {
        setLoadingState({
          isLoading: false,
          progress: 0,
        });
      }
    );

    return () => {
      progressSubscription.unsubscribe();
      completeSubscription.unsubscribe();
      viewportChangeSubscription.unsubscribe();
    };
  }, [servicesManager]);

  if (!loadingState.isLoading || loadingState.progress >= 100) {
    return null;
  }

  return (
    <div className="flex items-center gap-1 ml-1">
      {/* Small circular progress indicator */}
      <div className="relative w-4 h-4">
        <div className="absolute inset-0 rounded-full border-2 border-gray-600"></div>
        <div
          className="absolute inset-0 rounded-full border-2 border-primary-light border-t-transparent transition-transform duration-300"
          style={{
            transform: `rotate(${(loadingState.progress / 100) * 360}deg)`,
          }}
        ></div>
      </div>
      
      {/* Progress percentage text */}
      <div className="text-primary-active text-[10px] font-medium">
        {loadingState.progress}%
      </div>
    </div>
  );
}

export default LoadingProgressIndicator;