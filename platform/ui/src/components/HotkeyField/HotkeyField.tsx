import React, { useEffect } from 'react';
import PropTypes from 'prop-types';

import Input from '../Input';
import { getKeys, formatKeysForInput } from './utils';

/**
 * HotkeyField
 * Renders a hotkey input that records keys
 *
 * @param {object} props component props
 * @param {Array[]} props.keys keys to be controlled by this field
 * @param {boolean} props.disabled disables the field
 * @param {function} props.onChange callback with changed values
 * @param {string} props.className input classes
 * @param {Array[]} props.modifierKeys
 */
const HotkeyField = ({ disabled = false, keys, onChange, className, modifierKeys, hotkeys }) => {
  const inputValue = formatKeysForInput(keys);

  const onInputKeyDown = event => {
    hotkeys.record(sequence => {
      const keys = getKeys({ sequence, modifierKeys });
      hotkeys.unpause();
      onChange(keys);
    });
  };

  const onFocus = () => {
    hotkeys.pause();
    hotkeys.startRecording();
  };

  // Focusing the field pauses Mousetrap globally so the keys being recorded
  // don't trigger app shortcuts. If the field loses focus before a sequence is
  // recorded (e.g. the user closes the Preferences modal via Esc, the overlay,
  // the X button, or Save) the record-completion callback never runs, so we
  // must unpause here. Without this, all keyboard shortcuts stay dead until a
  // full page reload.
  const onBlur = () => {
    hotkeys.stopRecord?.();
    hotkeys.unpause();
  };

  // Safety net: onBlur does not reliably fire when the field is unmounted while
  // still focused (e.g. closing the Preferences modal via Esc/overlay/X with a
  // field focused). Always unpause on unmount so global shortcuts can never be
  // left permanently disabled.
  useEffect(() => {
    return () => {
      hotkeys.stopRecord?.();
      hotkeys.unpause();
    };
  }, [hotkeys]);

  return (
    <Input
      readOnly
      disabled={disabled}
      value={inputValue}
      onKeyDown={onInputKeyDown}
      onFocus={onFocus}
      onBlur={onBlur}
      className={className}
    />
  );
};

HotkeyField.propTypes = {
  keys: PropTypes.array.isRequired,
  onChange: PropTypes.func.isRequired,
  className: PropTypes.string,
  modifierKeys: PropTypes.array,
  disabled: PropTypes.bool,
  hotkeys: PropTypes.shape({
    initialize: PropTypes.func.isRequired,
    pause: PropTypes.func.isRequired,
    unpause: PropTypes.func.isRequired,
    startRecording: PropTypes.func.isRequired,
    record: PropTypes.func.isRequired,
  }).isRequired,
};

export default HotkeyField;
