import React, { useState } from 'react';
import PropTypes from 'prop-types';
import classNames from 'classnames';
import { useTranslation } from 'react-i18next';

import Typography from '../Typography';
import Select from '../Select';

const DefaultToolsPreferences = ({
  disabled = false,
  defaultToolBindings = [],
  onChange = () => {},
}) => {
  const { t } = useTranslation('UserPreferencesModal');
  const [toolBindings, setToolBindings] = useState(defaultToolBindings);

  const onToolChangeHandler = (id, selectedTool) => {
    const updatedBindings = toolBindings.map(binding =>
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

    setToolBindings(updatedBindings);
    onChange(id, selectedTool);
  };


  if (!toolBindings.length) {
    return (
      <div>
        {t('No default tools found')} - Length: {toolBindings.length}
      </div>
    );
  }

  return (
    <div className="flex flex-row justify-center">
      <div className="flex w-full flex-col">
        <div className="mb-4 text-center"></div>

        {/* Tool bindings */}
        {toolBindings.map(binding => (
          <div
            key={binding.id}
            className="mb-4 flex flex-row items-center justify-center"
          >
            <div className="flex w-40 justify-end pr-4">
              <Typography
                variant="subtitle"
                className="flex items-center whitespace-nowrap"
              >
                {binding.label}:
              </Typography>
            </div>
            <div className="flex w-60">
              <Select
                disabled={disabled}
                value={
                  binding.commandOptions?.toolName
                    ? {
                        value: binding.commandOptions.toolName,
                        label: binding.commandOptions.toolName,
                      }
                    : null
                }
                onChange={selectedOption =>
                  onToolChangeHandler(binding.id, selectedOption?.value || '')
                }
                className="h-8 w-full text-sm"
                isSearchable={false}
                isClearable={false}
                options={
                  binding.availableTools?.map(tool => ({
                    value: tool,
                    label: tool,
                  })) || []
                }
              />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

DefaultToolsPreferences.propTypes = {
  disabled: PropTypes.bool,
  defaultToolBindings: PropTypes.arrayOf(
    PropTypes.shape({
      id: PropTypes.string.isRequired,
      label: PropTypes.string.isRequired,
      commandOptions: PropTypes.object,
      availableTools: PropTypes.arrayOf(PropTypes.string),
    })
  ).isRequired,
  onChange: PropTypes.func,
  onActivateTool: PropTypes.func,
};

export default DefaultToolsPreferences;
