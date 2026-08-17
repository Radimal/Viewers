// Radimal top-left overlay: full patient/study context for vet reading
// (sex, neutered status, institution, referring physician, body part,
// acquisition time). Ported from the fork's inline items; shape converted
// customizationType -> inheritsFrom for 3.13's overlay dispatch.
export default {
  'viewportOverlay.topLeft': [
    {
      id: 'PatientName',
      inheritsFrom: 'ohif.overlayItem',
      label: '',
      title: 'Patient Name',
      condition: ({ referenceInstance }) => referenceInstance?.PatientName,
      contentF: ({ referenceInstance, formatters: { formatPN } }) =>
        `${formatPN(referenceInstance.PatientName)}`,
    },
    {
      id: 'PatientID',
      inheritsFrom: 'ohif.overlayItem',
      label: '',
      title: 'Patient ID',
      condition: ({ referenceInstance }) => referenceInstance?.PatientID,
      contentF: ({ referenceInstance }) => `${referenceInstance.PatientID}`,
    },
    {
      id: 'PatientSex',
      inheritsFrom: 'ohif.overlayItem',
      label: '',
      title: 'Patient Sex',
      condition: ({ referenceInstance }) => referenceInstance?.PatientSex,
      contentF: ({ referenceInstance }) => `Sex: ${referenceInstance.PatientSex}`,
    },
    {
      id: 'PatientNeutered',
      inheritsFrom: 'ohif.overlayItem',
      label: '',
      title: 'Patient Neutered',
      condition: ({ referenceInstance }) => referenceInstance?.PatientSexNeutered,
      contentF: ({ referenceInstance }) => `Neutered: ${referenceInstance.PatientSexNeutered}`,
    },
    {
      id: 'InstitutionName',
      inheritsFrom: 'ohif.overlayItem',
      label: '',
      title: 'Institution Name',
      condition: ({ referenceInstance }) => referenceInstance?.InstitutionName,
      contentF: ({ referenceInstance }) => `${referenceInstance.InstitutionName}`,
    },
    {
      id: 'ReferringPhysicianName',
      inheritsFrom: 'ohif.overlayItem',
      label: '',
      title: 'Referring Physician Name',
      condition: ({ referenceInstance }) => referenceInstance?.ReferringPhysicianName,
      contentF: ({ referenceInstance, formatters: { formatPN } }) =>
        `${formatPN(referenceInstance.ReferringPhysicianName)}`,
    },
    {
      id: 'SeriesDescription',
      inheritsFrom: 'ohif.overlayItem',
      label: '',
      title: 'Series description',
      condition: ({ referenceInstance }) => {
        return referenceInstance && referenceInstance.SeriesDescription;
      },
      contentF: ({ referenceInstance }) => referenceInstance.SeriesDescription,
    },
    {
      id: 'BodyPartExamined',
      inheritsFrom: 'ohif.overlayItem',
      label: '',
      title: 'Body Part Examined',
      condition: ({ referenceInstance }) => referenceInstance?.BodyPartExamined,
      contentF: ({ referenceInstance }) => referenceInstance.BodyPartExamined,
    },
    {
      id: 'StudyDate',
      inheritsFrom: 'ohif.overlayItem',
      label: '',
      title: 'Study date',
      condition: ({ referenceInstance }) => referenceInstance?.StudyDate,
      contentF: ({ referenceInstance, formatters: { formatDate, formatTime } }) =>
        `${formatDate(referenceInstance.StudyDate)}, ${formatTime(referenceInstance.StudyTime)}`,
    },
    {
      id: 'AcqDate',
      inheritsFrom: 'ohif.overlayItem',
      label: '',
      title: 'Acquisition date',
      condition: ({ referenceInstance }) => referenceInstance?.AcquisitionDate,
      contentF: ({ referenceInstance, formatters: { formatDate, formatTime } }) =>
        `Acq: ${formatDate(referenceInstance.AcquisitionDate)}, ${formatTime(referenceInstance.AcquisitionTime)}`,
    },
  ],
  'viewportOverlay.topRight': [],
  'viewportOverlay.bottomLeft': [
    {
      id: 'WindowLevel',
      inheritsFrom: 'ohif.overlayItem.windowLevel',
      title: 'Window Level',
    },
    {
      id: 'ZoomLevel',
      inheritsFrom: 'ohif.overlayItem.zoomLevel',
      condition: props => {
        const activeToolName = props.toolGroupService.getActiveToolForViewport(props.viewportId);
        return activeToolName === 'Zoom';
      },
    },
  ],
  'viewportOverlay.bottomRight': [
    {
      id: 'InstanceNumber',
      inheritsFrom: 'ohif.overlayItem.instanceNumber',
      title: 'Instance Number',
    },
  ],
};
