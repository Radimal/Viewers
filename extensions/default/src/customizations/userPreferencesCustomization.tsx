import React, { useMemo, useState, useEffect } from 'react';
import { useSystem, hotkeys as hotkeysModule } from '@ohif/core';
import { UserPreferencesModal, FooterAction } from '@ohif/ui-next';
import { useTranslation } from 'react-i18next';
import i18n from '@ohif/i18n';

import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@ohif/ui-next';

const { availableLanguages, defaultLanguage, currentLanguage: currentLanguageFn } = i18n;

interface HotkeyDefinition {
  keys: string;
  label: string;
}

interface HotkeyDefinitions {
  [key: string]: HotkeyDefinition;
}

const MODIFIER_OPTIONS = [
  { value: '16', label: 'Shift' },
  { value: '17', label: 'Ctrl' },
  { value: '18', label: 'Alt' },
  { value: '91', label: 'Meta' },
];

const DEFAULT_TOOL_BINDINGS_STORAGE_KEY = 'user-preferred-tool-bindings';

// Radimal: mouse-button tool assignment + zoom speed (fork parity).
const MOUSE_TOOL_OPTIONS = ['WindowLevel', 'Pan', 'Zoom'];
const MOUSE_BUTTONS = [
  { key: 'left', label: 'Left Click', mouseButton: 1 },
  { key: 'middle', label: 'Middle Click', mouseButton: 4 },
  { key: 'right', label: 'Right Click', mouseButton: 2 },
];
const DEFAULT_MOUSE_TOOLS = { left: 'WindowLevel', middle: 'Pan', right: 'Zoom' };
const ZOOM_SPEED_OPTIONS = ['0.05', '0.1', '0.2', '0.3', '0.4'];

function getZoomSpeedPref(): string {
  try {
    const saved = localStorage.getItem('zoomSpeed');
    return ZOOM_SPEED_OPTIONS.includes(saved) ? saved : '0.1';
  } catch (e) {
    return '0.1';
  }
}

/** Which of the three tools currently owns each mouse button in the default tool group. */
function getMouseToolAssignment(toolGroupService): Record<string, string> {
  const assignment = { ...DEFAULT_MOUSE_TOOLS };
  if (!toolGroupService) {
    return assignment;
  }
  MOUSE_TOOL_OPTIONS.forEach(toolName => {
    const bindings = toolGroupService.getToolBindings?.('default', toolName) || [];
    bindings.forEach(binding => {
      const button = MOUSE_BUTTONS.find(
        b => binding.mouseButton === b.mouseButton && binding.modifierKey == null
      );
      if (button) {
        assignment[button.key] = toolName;
      }
    });
  });
  return assignment;
}

/** Persist + apply the button->tool assignment on the default tool group. */
function applyMouseToolAssignment(toolGroupService, assignment: Record<string, string>): void {
  if (!toolGroupService) {
    return;
  }
  MOUSE_TOOL_OPTIONS.forEach(toolName => {
    const bindings = MOUSE_BUTTONS.filter(b => assignment[b.key] === toolName).map(b => ({
      mouseButton: b.mouseButton,
    }));
    if (!bindings.length) {
      return; // tool keeps toolbar/hotkey activation only
    }
    // Preserve touch bindings that button reassignment must not clobber.
    if (toolName === 'Zoom') {
      bindings.push({ numTouchPoints: 2 } as any);
    }
    toolGroupService.setToolBindings('default', toolName, bindings);
    toolGroupService.applyToolBindings('default', toolName, { replaceExisting: true });
    toolGroupService.persistToolBindings('default', toolName, bindings);
  });
}

function getToolModifier(
  toolGroupService: any,
  toolGroupId: string,
  toolName: string,
  mouseButton: number
): string | null {
  if (!toolGroupService) {
    return null;
  }
  const bindings = toolGroupService.getToolBindings(toolGroupId, toolName);
  if (!bindings?.length) {
    return null;
  }
  const modifierBinding = bindings.find(
    binding =>
      binding.mouseButton === mouseButton &&
      binding.modifierKey != null &&
      binding.numTouchPoints == null
  );

  return modifierBinding?.modifierKey != null ? String(modifierBinding.modifierKey) : null;
}

function getModifierFromBindings(
  bindings: Array<Record<string, unknown>> | undefined,
  mouseButton: number
): string | null {
  if (!bindings?.length) {
    return null;
  }

  const modifierBinding = bindings.find(
    binding =>
      binding.mouseButton === mouseButton &&
      binding.modifierKey != null &&
      binding.numTouchPoints == null
  );

  return modifierBinding?.modifierKey != null ? String(modifierBinding.modifierKey) : null;
}

function UserPreferencesModalDefault({ hide }: { hide: () => void }) {
  const { hotkeysManager, servicesManager } = useSystem();
  const { t, i18n: i18nextInstance } = useTranslation('UserPreferencesModal');
  const toolGroupService = (servicesManager as any)?.services?.toolGroupService;

  const { hotkeyDefinitions = {}, hotkeyDefaults = {} } = hotkeysManager;

  const fallbackHotkeyDefinitions = useMemo(
    () =>
      hotkeysManager.getValidHotkeyDefinitions(
        hotkeysModule.defaults.hotkeyBindings
      ) as HotkeyDefinitions,
    [hotkeysManager]
  );

  useEffect(() => {
    if (!Object.keys(hotkeyDefaults).length) {
      hotkeysManager.setDefaultHotKeys(hotkeysModule.defaults.hotkeyBindings);
    }

    if (!Object.keys(hotkeyDefinitions).length) {
      hotkeysManager.setHotkeys(fallbackHotkeyDefinitions);
    }
  }, [hotkeysManager, hotkeyDefaults, hotkeyDefinitions, fallbackHotkeyDefinitions]);

  const resolvedHotkeyDefaults = Object.keys(hotkeyDefaults).length
    ? (hotkeyDefaults as HotkeyDefinitions)
    : fallbackHotkeyDefinitions;

  const initialHotkeyDefinitions = Object.keys(hotkeyDefinitions).length
    ? (hotkeyDefinitions as HotkeyDefinitions)
    : resolvedHotkeyDefaults;

  const currentLanguage = currentLanguageFn();

  const initialCrosshairModifier = useMemo(
    () => getToolModifier(toolGroupService, 'mpr', 'Crosshairs', 1),
    [toolGroupService]
  );
  const defaultCrosshairBindings = useMemo(
    () => toolGroupService?.getDefaultToolBindings?.('mpr', 'Crosshairs'),
    [toolGroupService]
  );

  const [state, setState] = useState({
    hotkeyDefinitions: initialHotkeyDefinitions,
    languageValue: currentLanguage.value,
    crosshairModifier: initialCrosshairModifier,
    mouseTools: getMouseToolAssignment(toolGroupService),
    zoomSpeed: getZoomSpeedPref(),
  });

  const onLanguageChangeHandler = (value: string) => {
    setState(state => ({ ...state, languageValue: value }));
  };

  const onHotkeyChangeHandler = (id: string, newKeys: string) => {
    setState(state => ({
      ...state,
      hotkeyDefinitions: {
        ...state.hotkeyDefinitions,
        [id]: {
          ...state.hotkeyDefinitions[id],
          keys: newKeys,
        },
      },
    }));
  };

  const onResetHandler = () => {
    setState(state => ({
      ...state,
      languageValue: defaultLanguage.value,
      hotkeyDefinitions: resolvedHotkeyDefaults,
      crosshairModifier: getModifierFromBindings(defaultCrosshairBindings, 1),
    }));

    setState(state => ({ ...state, mouseTools: { ...DEFAULT_MOUSE_TOOLS }, zoomSpeed: '0.1' }));
    MOUSE_TOOL_OPTIONS.forEach(toolName =>
      toolGroupService?.removePersistedToolBindings?.('default', toolName)
    );
    hotkeysManager.restoreDefaultBindings();
    if (toolGroupService && defaultCrosshairBindings?.length) {
      toolGroupService.setToolBindings('mpr', 'Crosshairs', defaultCrosshairBindings);
      toolGroupService.applyToolBindings('mpr', 'Crosshairs', {
        replaceExisting: true,
      });
    }
    toolGroupService?.removePersistedToolBindings('mpr', 'Crosshairs');
  };

  const displayNames = React.useMemo(() => {
    if (typeof Intl === 'undefined' || typeof Intl.DisplayNames !== 'function') {
      return null;
    }

    const locales = [state.languageValue, currentLanguage.value, i18nextInstance.language, 'en'];
    const uniqueLocales = Array.from(new Set(locales.filter(Boolean)));

    try {
      return new Intl.DisplayNames(uniqueLocales, { type: 'language', fallback: 'none' });
    } catch (error) {
      console.warn('Intl.DisplayNames not supported for locales', uniqueLocales, error);
    }

    return null;
  }, [state.languageValue, currentLanguage.value, i18nextInstance.language]);

  const getLanguageLabel = React.useCallback(
    (languageValue: string, fallbackLabel: string) => {
      const translationKey = `LanguageName.${languageValue}`;
      if (i18nextInstance.exists(translationKey, { ns: 'UserPreferencesModal' })) {
        return t(translationKey);
      }

      if (displayNames) {
        try {
          const localized = displayNames.of(languageValue);
          if (localized && localized.toLowerCase() !== languageValue.toLowerCase()) {
            return localized.charAt(0).toUpperCase() + localized.slice(1);
          }
        } catch (error) {
          console.debug(`Unable to resolve display name for ${languageValue}`, error);
        }
      }

      return fallbackLabel;
    },
    [displayNames, i18nextInstance, t]
  );

  return (
    <UserPreferencesModal>
      <UserPreferencesModal.Body>
        {/* Language Section */}
        <div className="mb-3 flex items-center space-x-14">
          <UserPreferencesModal.SubHeading>{t('Language')}</UserPreferencesModal.SubHeading>
          <Select
            defaultValue={state.languageValue}
            onValueChange={onLanguageChangeHandler}
          >
            <SelectTrigger
              className="w-60"
              aria-label="Language"
            >
              <SelectValue placeholder={t('Select language')} />
            </SelectTrigger>
            <SelectContent>
              {availableLanguages.map(lang => (
                <SelectItem
                  key={lang.value}
                  value={lang.value}
                >
                  {getLanguageLabel(lang.value, lang.label)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <UserPreferencesModal.SubHeading>{t('Hotkeys')}</UserPreferencesModal.SubHeading>
        <UserPreferencesModal.HotkeysGrid>
          {Object.entries(state.hotkeyDefinitions).map(([id, definition]) => (
            <UserPreferencesModal.Hotkey
              key={id}
              label={t(definition.label)}
              value={definition.keys}
              onChange={newKeys => onHotkeyChangeHandler(id, newKeys)}
              placeholder={definition.keys}
              hotkeys={hotkeysModule}
            />
          ))}
        </UserPreferencesModal.HotkeysGrid>

        <UserPreferencesModal.SubHeading>
          {t('MouseTools', { defaultValue: 'Mouse Buttons' })}
        </UserPreferencesModal.SubHeading>
        <UserPreferencesModal.HotkeysGrid>
          {MOUSE_BUTTONS.map(button => (
            <div
              key={button.key}
              className="flex items-center justify-between gap-2"
            >
              <span className="text-foreground text-base">{t(button.label)}</span>
              <Select
                value={state.mouseTools[button.key]}
                onValueChange={val =>
                  setState(s => ({ ...s, mouseTools: { ...s.mouseTools, [button.key]: val } }))
                }
              >
                <SelectTrigger className="w-36">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {MOUSE_TOOL_OPTIONS.map(toolName => (
                    <SelectItem
                      key={toolName}
                      value={toolName}
                    >
                      {t(toolName)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          ))}
          <div className="flex items-center justify-between gap-2">
            <span className="text-foreground text-base">
              {t('ZoomSpeed', { defaultValue: 'Zoom Speed' })}
            </span>
            <Select
              value={state.zoomSpeed}
              onValueChange={val => setState(s => ({ ...s, zoomSpeed: val }))}
            >
              <SelectTrigger className="w-36">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {ZOOM_SPEED_OPTIONS.map(speed => (
                  <SelectItem
                    key={speed}
                    value={speed}
                  >
                    {Math.round(parseFloat(speed) * 100)}%
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </UserPreferencesModal.HotkeysGrid>

        {state.crosshairModifier != null && (
          <>
            <UserPreferencesModal.SubHeading>
              {t('ModifierKeys', { defaultValue: 'Modifier Keys' })}
            </UserPreferencesModal.SubHeading>
            <UserPreferencesModal.HotkeysGrid>
              <div className="flex items-center justify-between gap-2">
                <span className="text-foreground text-base">
                  {t('CrosshairsModifier', { defaultValue: 'Crosshairs' })}
                </span>
                <div className="flex items-center gap-1.5">
                  <span className="text-muted-foreground text-sm">
                    {t('PlusLeftClick', { defaultValue: 'Left Click +' })}
                  </span>
                  <Select
                    value={state.crosshairModifier}
                    onValueChange={val => setState(s => ({ ...s, crosshairModifier: val }))}
                  >
                    <SelectTrigger className="w-16">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {MODIFIER_OPTIONS.map(opt => (
                        <SelectItem
                          key={opt.value}
                          value={opt.value}
                        >
                          {opt.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </UserPreferencesModal.HotkeysGrid>
          </>
        )}
      </UserPreferencesModal.Body>
      <FooterAction>
        <FooterAction.Left>
          <FooterAction.Auxiliary onClick={onResetHandler}>
            {t('Reset to defaults')}
          </FooterAction.Auxiliary>
        </FooterAction.Left>
        <FooterAction.Right>
          <FooterAction.Secondary
            onClick={() => {
              hotkeysModule.stopRecord();
              hotkeysModule.unpause();
              hide();
            }}
          >
            {t('Cancel')}
          </FooterAction.Secondary>
          <FooterAction.Primary
            onClick={() => {
              if (state.languageValue !== currentLanguage.value) {
                i18n.changeLanguage(state.languageValue);
                // Force page reload after language change to ensure all translations are applied
                window.location.reload();
                return; // Exit early since we're reloading
              }
              hotkeysManager.setHotkeys(state.hotkeyDefinitions);

              // Radimal: mouse-button tools + zoom speed
              applyMouseToolAssignment(toolGroupService, state.mouseTools);
              try {
                localStorage.setItem('zoomSpeed', state.zoomSpeed);
              } catch (e) {
                /* storage unavailable */
              }

              if (toolGroupService && state.crosshairModifier != null) {
                const bindings = [
                  { mouseButton: 1, modifierKey: Number(state.crosshairModifier) },
                ];
                toolGroupService.setToolBindings('mpr', 'Crosshairs', bindings);
                toolGroupService.applyToolBindings('mpr', 'Crosshairs', {
                  replaceExisting: true,
                });
                toolGroupService.persistToolBindings('mpr', 'Crosshairs', bindings);
              }

              hotkeysModule.stopRecord();
              hotkeysModule.unpause();
              hide();
            }}
          >
            {t('Save')}
          </FooterAction.Primary>
        </FooterAction.Right>
      </FooterAction>
    </UserPreferencesModal>
  );
}

export default {
  'ohif.userPreferencesModal': UserPreferencesModalDefault,
  'ohif.userPreferences.toolBindingsStorageKey': DEFAULT_TOOL_BINDINGS_STORAGE_KEY,
};
