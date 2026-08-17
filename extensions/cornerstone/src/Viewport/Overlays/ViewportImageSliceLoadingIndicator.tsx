import React, { useEffect, useState, useRef } from 'react';
import PropTypes from 'prop-types';
import { Enums } from '@cornerstonejs/core';
import { Icons, Tooltip, TooltipContent, TooltipTrigger } from '@ohif/ui-next';

function ViewportImageSliceLoadingIndicator({ viewportData, element }) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);

  const loadIndicatorRef = useRef(null);
  const setLoadingState = evt => {
    clearTimeout(loadIndicatorRef.current);
    setError(false);

    loadIndicatorRef.current = setTimeout(() => {
      setLoading(true);
    }, 50);
  };

  const setFinishLoadingState = evt => {
    clearTimeout(loadIndicatorRef.current);

    setLoading(false);
    setError(false);
  };

  const setErrorState = evt => {
    clearTimeout(loadIndicatorRef.current);

    const eventError = evt.detail.error;
    setLoading(false);
    setError({
      message: eventError?.message || String(eventError || 'Unknown image rendering error'),
      status: eventError?.status || eventError?.response?.status,
      imageId: evt.detail.imageId,
    });
  };

  useEffect(() => {
    element.addEventListener(Enums.Events.STACK_VIEWPORT_SCROLL, setLoadingState);
    element.addEventListener(Enums.Events.IMAGE_LOAD_ERROR, setErrorState);
    element.addEventListener(Enums.Events.STACK_NEW_IMAGE, setFinishLoadingState);

    return () => {
      element.removeEventListener(Enums.Events.STACK_VIEWPORT_SCROLL, setLoadingState);

      element.removeEventListener(Enums.Events.STACK_NEW_IMAGE, setFinishLoadingState);

      element.removeEventListener(Enums.Events.IMAGE_LOAD_ERROR, setErrorState);
    };
  }, [element, viewportData]);

  if (error) {
    const errorMessage = error?.message || String(error);

    return (
      <div className="absolute top-2 right-2 z-10">
        <Tooltip>
          <TooltipTrigger aria-label="Image rendering failed">
            <div className="rounded bg-black/80 p-1">
              <Icons.StatusWarning className="h-5 w-5 text-yellow-300" />
            </div>
          </TooltipTrigger>
          <TooltipContent side="left">
            <div className="max-w-80 text-left text-sm text-white">
              <div className="font-semibold text-yellow-300">Image failed to render</div>
              <div className="mt-1 break-words">{errorMessage}</div>
              {error?.status && <div className="mt-1">HTTP status: {error.status}</div>}
              {error?.imageId && <div className="mt-1 break-all">{error.imageId}</div>}
            </div>
          </TooltipContent>
        </Tooltip>
      </div>
    );
  }

  if (loading) {
    return (
      // IMPORTANT: we need to use the pointer-events-none class to prevent the loading indicator from
      // interacting with the mouse, since scrolling should propagate to the viewport underneath
      <div className="pointer-events-none absolute top-0 left-0 h-full w-full bg-black opacity-50">
        <div className="transparent flex h-full w-full items-center justify-center">
          <p className="text-highlight text-xl font-light">Loading...</p>
        </div>
      </div>
    );
  }

  return null;
}

ViewportImageSliceLoadingIndicator.propTypes = {
  error: PropTypes.object,
  element: PropTypes.object,
};

export default ViewportImageSliceLoadingIndicator;
