/*
 * Default tool configurations for mouse button assignments
 */
const defaultToolBindings = [
  {
    id: 'leftMouseButton',
    commandName: 'updateMouseButtonBinding',
    commandOptions: { mouseButton: 'Primary', toolName: 'WindowLevel' },
    label: 'Left Mouse Button',
    mouseButton: 'Primary',
    isEditable: true,
    availableTools: ['WindowLevel', 'Pan', 'Zoom'],
  },
  {
    id: 'rightMouseButton',
    commandName: 'updateMouseButtonBinding',
    commandOptions: { mouseButton: 'Secondary', toolName: 'Pan' },
    label: 'Right Mouse Button',
    mouseButton: 'Secondary',
    isEditable: true,
    availableTools: ['WindowLevel', 'Pan', 'Zoom'],
  },
  {
    id: 'middleMouseButton',
    commandName: 'updateMouseButtonBinding',
    commandOptions: { mouseButton: 'Auxiliary', toolName: 'Zoom' },
    label: 'Middle Mouse Button',
    mouseButton: 'Auxiliary',
    isEditable: true,
    availableTools: ['WindowLevel', 'Pan', 'Zoom'],
  },
];

export default defaultToolBindings;