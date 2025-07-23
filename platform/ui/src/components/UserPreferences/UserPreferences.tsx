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

  const getSavedToolBindings = () => {
    try {
      const saved = localStorage.getItem('defaultToolBindings');
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
  });

  const onSubmitHandler = () => {
    // Save tool bindings to localStorage
    try {
      localStorage.setItem('defaultToolBindings', JSON.stringify(state.defaultToolBindings));
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
      defaultToolBindings: defaultToolBindings, // Reset to original defaults
    }));
    // Clear saved tool bindings
    try {
      localStorage.removeItem('defaultToolBindings');
    } catch (error) {
      console.warn('Failed to clear saved tool bindings:', error);
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
    }));

    try {
      localStorage.setItem('defaultToolBindings', JSON.stringify(updatedBindings));
    } catch (error) {
      console.warn('Failed to save tool bindings:', error);
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
