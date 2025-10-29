import React, { useState } from 'react';
import PropTypes from 'prop-types';
import { useTranslation } from 'react-i18next';

import Select from '../Select';
import CheckBox from '../CheckBox';
import Typography from '../Typography';
import Button from '../Button';
import HotkeysPreferences from '../HotkeysPreferences';
import DefaultToolsPreferences from '../DefaultToolsPreferences';
import { ButtonEnums } from '../Button';
import Input from '../Input';

const UserPreferences = ({
  availableLanguages,
  defaultLanguage,
  currentLanguage,
  disabled = false,
  hotkeyDefinitions,
  hotkeyDefaults,
  defaultToolBindings = [],
  onCancel = () => {},
  onSubmit = () => {},
  onReset = () => {},
  onActivateTool = () => {},
  hotkeysModule,
}) => {
  const { t } = useTranslation('UserPreferencesModal');
  let openAdditionalWindowsOnStart = localStorage.getItem('openAdditionalWindowsOnStart');
  if (openAdditionalWindowsOnStart) {
    openAdditionalWindowsOnStart = JSON.parse(openAdditionalWindowsOnStart);
  }

  let scrollWheelPreference = localStorage.getItem('scrollWheelTool');
  if (!scrollWheelPreference) {
    scrollWheelPreference = 'StackScroll';
  }

  let zoomSpeedPreference = localStorage.getItem('zoomSpeed');
  if (!zoomSpeedPreference || zoomSpeedPreference === 'NaN') {
    zoomSpeedPreference = '0.1';
  }

  const parsedZoomSpeed = parseFloat(zoomSpeedPreference);
  if (isNaN(parsedZoomSpeed)) {
    zoomSpeedPreference = '0.1';
    localStorage.setItem('zoomSpeed', '0.1');
  }

  let invertScrollWheelPreference = localStorage.getItem('invertScrollWheel');
  if (invertScrollWheelPreference === null) {
    invertScrollWheelPreference = 'false';
  }

  let viewerOverrideDisabled = localStorage.getItem('viewerOverrideDisabled');
  if (viewerOverrideDisabled === null) {
    viewerOverrideDisabled = 'false';
  }

  const getSavedToolBindings = () => {
    // Always start with the default tool bindings
    if (!defaultToolBindings || defaultToolBindings.length === 0) {
      return [];
    }

    try {
      const saved = localStorage.getItem('defaultToolBindings');
      const scrollWheelTool = localStorage.getItem('scrollWheelTool');

      if (saved) {
        const parsedSaved = JSON.parse(saved);
        return defaultToolBindings.map(defaultBinding => {
          const savedBinding = parsedSaved.find(s => s.id === defaultBinding.id);
          if (savedBinding) {
            return {
              ...defaultBinding,
              ...savedBinding,
              availableTools: defaultBinding.availableTools,
            };
          }
          if (defaultBinding.id === 'scrollWheel' && scrollWheelTool) {
            return {
              ...defaultBinding,
              commandOptions: {
                ...defaultBinding.commandOptions,
                toolName: scrollWheelTool,
              },
            };
          }
          return defaultBinding;
        });
      } else if (scrollWheelTool) {
        return defaultToolBindings.map(defaultBinding => {
          if (defaultBinding.id === 'scrollWheel') {
            return {
              ...defaultBinding,
              commandOptions: {
                ...defaultBinding.commandOptions,
                toolName: scrollWheelTool,
              },
            };
          }
          return defaultBinding;
        });
      }
    } catch (error) {
      console.warn('Failed to load saved tool bindings:', error);
    }
    return defaultToolBindings;
  };

  const [state, setState] = useState({
    isDisabled: disabled,
    hotkeyErrors: {},
    hotkeyDefinitions,
    defaultToolBindings: getSavedToolBindings(),
    language: currentLanguage,
    openAdditionalWindowsOnStart: !!openAdditionalWindowsOnStart,
    scrollWheelTool: scrollWheelPreference,
    zoomSpeed: zoomSpeedPreference,
    invertScrollWheel: invertScrollWheelPreference === 'true',
    viewerOverrideDisabled: viewerOverrideDisabled === 'true',
  });

  const onSubmitHandler = () => {
    // Save tool bindings to localStorage
    try {
      localStorage.setItem('defaultToolBindings', JSON.stringify(state.defaultToolBindings));
      localStorage.setItem('zoomSpeed', state.zoomSpeed.toString());
      localStorage.setItem('invertScrollWheel', state.invertScrollWheel.toString());
      localStorage.setItem('viewerOverrideDisabled', state.viewerOverrideDisabled.toString());
    } catch (error) {
      console.warn('Failed to save tool bindings:', error);
    }
    onSubmit(state);
  };

  const onResetHandler = () => {
    setState(state => ({
      ...state,
      language: defaultLanguage,
      hotkeyDefinitions: hotkeyDefaults,
      hotkeyErrors: {},
      isDisabled: disabled,
      defaultToolBindings: defaultToolBindings,
      scrollWheelTool: 'StackScroll',
      zoomSpeed: '0.1',
      invertScrollWheel: false,
      viewerOverrideDisabled: false,
    }));
    try {
      localStorage.removeItem('defaultToolBindings');
      localStorage.removeItem('scrollWheelTool');
      localStorage.removeItem('zoomSpeed');
      localStorage.removeItem('invertScrollWheel');
      localStorage.removeItem('viewerOverrideDisabled');
    } catch (error) {
      console.warn('Failed to clear saved preferences:', error);
    }
    onReset();
  };

  const onCancelHandler = () => {
    setState({ hotkeyDefinitions });
    onCancel();
  };

  const onLanguageChangeHandler = value => {
    setState(state => ({ ...state, language: value }));
  };

  const onWindowChangeHandler = value => {
    setState(state => ({ ...state, openAdditionalWindowsOnStart: value }));
    localStorage.setItem('openAdditionalWindowsOnStart', JSON.stringify(value));
  };

  const onHotkeysChangeHandler = (id, definition, errors) => {
    setState(state => ({
      ...state,
      isDisabled: Object.values(errors).every(e => e !== undefined),
      hotkeyErrors: errors,
      hotkeyDefinitions: {
        ...state.hotkeyDefinitions,
        [id]: definition,
      },
    }));
  };

  const onDefaultToolsChangeHandler = (id, selectedTool) => {
    const updatedBindings = state.defaultToolBindings.map(binding =>
      binding.id === id
        ? {
            ...binding,
            commandOptions: {
              ...binding.commandOptions,
              toolName: selectedTool,
            },
          }
        : binding
    );

    setState(state => ({
      ...state,
      defaultToolBindings: updatedBindings,
      scrollWheelTool: id === 'scrollWheel' ? selectedTool : state.scrollWheelTool,
    }));

    try {
      localStorage.setItem('defaultToolBindings', JSON.stringify(updatedBindings));
      if (id === 'scrollWheel') {
        localStorage.setItem('scrollWheelTool', selectedTool);
      }
    } catch (error) {
      console.warn('Failed to save tool bindings:', error);
    }
  };

  const zoomSpeedOptions = [
    { label: '0.5x (Slow)', value: '0.05' },
    { label: '1x (Normal)', value: '0.1' },
    { label: '2x (Fast)', value: '0.2' },
    { label: '3x (Faster)', value: '0.3' },
    { label: '4x (Very Fast)', value: '0.4' },
  ];

  const onZoomSpeedChangeHandler = value => {
    const actualValue =
      typeof value === 'object' && value.value !== undefined ? value.value : value;

    setState(state => ({
      ...state,
      zoomSpeed: actualValue,
    }));

    try {
      localStorage.setItem('zoomSpeed', actualValue);
    } catch (error) {
      console.warn('Failed to save zoom speed:', error);
    }
  };

  const onInvertScrollWheelChangeHandler = value => {
    setState(state => ({
      ...state,
      invertScrollWheel: value,
    }));

    try {
      localStorage.setItem('invertScrollWheel', value.toString());
    } catch (error) {
      console.warn('Failed to save scroll wheel inversion:', error);
    }
  };

  const onViewerOverrideChangeHandler = value => {
    setState(state => ({
      ...state,
      viewerOverrideDisabled: value,
    }));

    try {
      localStorage.setItem('viewerOverrideDisabled', value.toString());
      if (window.opener && window.name === 'viewerWindow') {
        let origin;
        if (window.location.origin === 'http://localhost:3000') {
          origin = 'http://localhost:8000';
        } else if (window.location.origin === 'https://viewer.stage-1.radimal.ai') {
          origin = 'https://radimal-vet-staging.onrender.com';
        } else if (window.location.origin === 'https://view.radimal.ai') {
          origin = 'https://vet.radimal.ai';
        }
        window.opener.postMessage(
          {
            type: 'VIEWER_OVERRIDE_CHANGED',
            value: value,
          },
          origin || '*'
        );
      }
    } catch (error) {
      console.warn('Failed to save viewer override setting:', error);
    }
  };

  const onApplyChanges = () => {
    try {
      localStorage.setItem('defaultToolBindings', JSON.stringify(state.defaultToolBindings));
    } catch (error) {
      console.warn('Failed to save tool bindings:', error);
    }
    window.location.reload();
  };

  const Section = ({ title, children }) => (
    <>
      <div className="mb-2 border-b-2 border-black">
        <Typography
          variant="inherit"
          color="primaryLight"
          className="flex pb-2 text-[16px] font-semibold !leading-[1.2]"
        >
          {title}
        </Typography>
      </div>
      <div className="mt-4 mb-8">{children}</div>
    </>
  );

  return (
    <>
      <Section title={t('General')}>
        <div className="flex w-72 flex-row items-center justify-center">
          <Typography
            variant="subtitle"
            className="mr-5 h-full text-right"
          >
            {t('Language')}
          </Typography>
          <Select
            isClearable={false}
            onChange={onLanguageChangeHandler}
            options={availableLanguages}
            value={state.language}
          />
        </div>
      </Section>
      <Section title={t('Additional Windows')}>
        <div className="flex w-72 flex-row items-center justify-center">
          <Typography
            variant="subtitle"
            className="mr-5 h-full text-right"
          >
            {t('Open Additional Windows On Start')}
          </Typography>
          <CheckBox
            checked={state.openAdditionalWindowsOnStart}
            onChange={onWindowChangeHandler}
          ></CheckBox>
        </div>
      </Section>
      <Section title={t('Default Tool Assignments')}>
        <DefaultToolsPreferences
          disabled={disabled}
          defaultToolBindings={state.defaultToolBindings}
          onChange={onDefaultToolsChangeHandler}
          onActivateTool={onActivateTool}
        />

        <div className="mt-6 mb-4 flex flex-row items-center justify-center">
          <div className="flex w-40 justify-end pr-4">
            <Typography
              variant="subtitle"
              className="flex items-center whitespace-nowrap"
            >
              Zoom Speed:
            </Typography>
          </div>
          <div className="flex w-60 items-center">
            <Select
              disabled={disabled}
              isClearable={false}
              placeholder={
                zoomSpeedOptions.find(opt => opt.value === state.zoomSpeed)?.label ||
                'Select zoom speed...'
              }
              value={zoomSpeedOptions.find(opt => opt.value === state.zoomSpeed) || null}
              onChange={value => onZoomSpeedChangeHandler(value)}
              options={zoomSpeedOptions}
            />
            <Typography
              variant="body"
              className="ml-2 text-sm text-gray-400"
            >
              Zoom factor
            </Typography>
          </div>
        </div>

        <div className="mt-4 mb-4 flex flex-row items-center justify-center">
          <div className="flex w-40 justify-end pr-4">
            <Typography
              variant="subtitle"
              className="flex items-center whitespace-nowrap"
            >
              Invert Scroll Direction:
            </Typography>
          </div>
          <div className="flex w-60 items-center">
            <CheckBox
              checked={state.invertScrollWheel}
              onChange={onInvertScrollWheelChangeHandler}
            />
            <Typography
              variant="body"
              className="ml-2 text-sm text-gray-400"
            >
              Reverse scroll wheel direction
            </Typography>
          </div>
        </div>

        <div className="mt-4 mb-4 flex flex-row items-center justify-center">
          <div className="flex w-40 justify-end pr-4">
            <Typography
              variant="subtitle"
              className="flex items-center whitespace-nowrap"
            >
              Disable Viewer Auto-behavior:
            </Typography>
          </div>
          <div className="flex w-60 items-center">
            <CheckBox
              checked={state.viewerOverrideDisabled}
              onChange={onViewerOverrideChangeHandler}
            />
            <Typography
              variant="body"
              className="ml-2 text-sm text-gray-400"
            >
              Disables automatic viewer opening and fade in/out
            </Typography>
          </div>
        </div>

        <div className="mt-4 flex flex-col items-center">
          <Button
            type={ButtonEnums.type.primary}
            onClick={onApplyChanges}
            disabled={disabled}
            className="px-6"
          >
            Apply Tool Changes
          </Button>
          <div className="mt-4 text-center">
            <Typography
              variant="body"
              className="text-sm text-gray-400"
            >
              Note: Clicking Apply will save your preferences and refresh the page to apply changes.
            </Typography>
          </div>
        </div>
      </Section>
      <Section title={t('Hotkeys')}>
        <HotkeysPreferences
          disabled={disabled}
          hotkeyDefinitions={state.hotkeyDefinitions}
          onChange={onHotkeysChangeHandler}
          errors={state.hotkeyErrors}
          hotkeysModule={hotkeysModule}
        />
      </Section>
      <div className="flex flex-row justify-between">
        <Button
          type={ButtonEnums.type.secondary}
          onClick={onResetHandler}
          disabled={disabled}
        >
          {t('Reset to defaults')}
        </Button>
        <div className="flex flex-row">
          <Button
            type={ButtonEnums.type.secondary}
            onClick={onCancelHandler}
          >
            {t('Cancel')}
          </Button>
          <Button
            disabled={state.isDisabled}
            className="ml-2"
            onClick={onSubmitHandler}
          >
            {t('Save')}
          </Button>
        </div>
      </div>
    </>
  );
};

const noop = () => {};

UserPreferences.propTypes = {
  disabled: PropTypes.bool,
  hotkeyDefaults: PropTypes.object.isRequired,
  hotkeyDefinitions: PropTypes.object.isRequired,
  defaultToolBindings: PropTypes.array,
  onCancel: PropTypes.func,
  onSubmit: PropTypes.func,
  onReset: PropTypes.func,
  onActivateTool: PropTypes.func,
  hotkeysModule: PropTypes.shape({
    initialize: PropTypes.func.isRequired,
    pause: PropTypes.func.isRequired,
    unpause: PropTypes.func.isRequired,
    startRecording: PropTypes.func.isRequired,
    record: PropTypes.func.isRequired,
  }).isRequired,
};

export default UserPreferences;
