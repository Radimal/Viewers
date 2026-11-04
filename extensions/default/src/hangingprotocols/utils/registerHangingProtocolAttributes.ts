import viewCode from './viewCode';
import laterality from './laterality';
import { LAYOUT_GROUP_ATTRIBUTE, studyLayoutGroup } from '../../utils/layoutPreference';

export default function registerHangingProtocolAttributes({ servicesManager }) {
  const { hangingProtocolService } = servicesManager.services;
  hangingProtocolService.addCustomAttribute('ViewCode', 'View Code Designator:Value', viewCode);
  hangingProtocolService.addCustomAttribute('Laterality', 'Laterality of object', laterality);
  // Radimal: picks the per-modality default layout protocol for a study.
  hangingProtocolService.addCustomAttribute(
    LAYOUT_GROUP_ATTRIBUTE,
    "Study's main modality group, for per-modality default layouts",
    (study, options) => studyLayoutGroup(study, options?.displaySets)
  );
}
