import { InstanceMetadata } from './StudyMetadata';

export type DisplaySet = {
  displaySetInstanceUID: string;
  instances: InstanceMetadata[];
  StudyInstanceUID: string;
  SeriesInstanceUID?: string;
  SeriesNumber?: number;
  SeriesDescription?: string;
  numImages?: number;
  unsupported?: boolean;
  Modality?: string;
  imageIds?: string[];
  images?: unknown[];
};

export type DisplaySetSeriesMetadataInvalidatedEvent = {
  displaySetInstanceUID: string;
  invalidateData: boolean;
  /** True when instances were only appended; existing image metadata is unchanged. */
  appendedOnly?: boolean;
};
