import { volumeLoader } from '@cornerstonejs/core';
import {
  cornerstoneStreamingImageVolumeLoader,
  cornerstoneStreamingDynamicImageVolumeLoader,
} from '@cornerstonejs/core/loaders';
import dicomImageLoader from '@cornerstonejs/dicom-image-loader';
import { errorHandler, utils } from '@ohif/core';
import { attachStallWatchdog } from './utils/imageLoadRecovery';

const { registerVolumeLoader } = volumeLoader;

export default function initWADOImageLoader(
  userAuthenticationService,
  appConfig,
  extensionManager
) {
  registerVolumeLoader('cornerstoneStreamingImageVolume', cornerstoneStreamingImageVolumeLoader);

  registerVolumeLoader(
    'cornerstoneStreamingDynamicImageVolume',
    cornerstoneStreamingDynamicImageVolumeLoader
  );

  dicomImageLoader.init({
    maxWebWorkers: Math.min(
      Math.max(navigator.hardwareConcurrency - 1, 1),
      appConfig.maxNumberOfWebWorkers
    ),
    beforeSend: function (xhr, imageId) {
      // Abort transfers that stall mid-flight (dead client connections on
      // large frames otherwise hang forever and leave the image blank for
      // the whole session — the failure path in init.tsx then retries them).
      attachStallWatchdog(xhr, imageId, {
        stallTimeoutMs: appConfig.imageLoadStallTimeoutMs ?? 90000,
        maxDurationMs: appConfig.imageLoadMaxDurationMs ?? 600000,
      });

      //TODO should be removed in the future and request emitted by DicomWebDataSource
      const sourceConfig = extensionManager.getActiveDataSource()?.[0].getConfig() ?? {};
      const headers = userAuthenticationService.getAuthorizationHeader();
      const acceptHeader = utils.generateAcceptHeader(
        sourceConfig.acceptHeader,
        sourceConfig.requestTransferSyntaxUID,
        sourceConfig.omitQuotationForMultipartRequest
      );

      const xhrRequestHeaders = {
        Accept: acceptHeader,
      };

      if (headers) {
        Object.assign(xhrRequestHeaders, headers);
      }

      return xhrRequestHeaders;
    },
    errorInterceptor: error => {
      const handler = errorHandler.getHTTPErrorHandler();
      if (typeof handler === 'function') {
        handler(error);
      } else {
        console.error('⚠️ WADO image load error - no error handler configured:', error);
      }
    },
  });
}

export function destroy() {
  console.debug('Destroying WADO Image Loader');
}
