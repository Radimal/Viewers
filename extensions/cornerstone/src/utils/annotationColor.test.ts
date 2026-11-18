let mockStyles = {
  global: { color: 'rgb(255, 255, 0)', colorSelected: 'rgb(0, 220, 0)', lineWidth: '1.5' },
};

jest.mock('@cornerstonejs/core', () => ({ getRenderingEngines: () => [] }));
jest.mock('@cornerstonejs/tools', () => ({
  annotation: {
    config: {
      style: {
        getDefaultToolStyles: () => mockStyles,
        setDefaultToolStyles: next => (mockStyles = next),
      },
    },
  },
}));

import {
  applyAnnotationColor,
  saveAnnotationColor,
  getAnnotationColor,
  followAnnotationColor,
} from './annotationColor';

describe('annotationColor', () => {
  beforeEach(() => localStorage.clear());

  it('readers who never picked a color get pink in every state, not green when selected', () => {
    applyAnnotationColor();
    expect(mockStyles.global).toMatchObject({ color: '#fe01a1', colorSelected: '#fe01a1' });
  });

  it('a pick colors every state and survives a reload; reset restores the default', () => {
    saveAnnotationColor('#ff00ff');
    expect(mockStyles.global).toMatchObject({
      color: '#ff00ff',
      colorSelected: '#ff00ff',
      textBoxColorHighlighted: '#ff00ff',
      colorLocked: '#ff00ff',
      lineWidth: '1.5',
    });
    expect(getAnnotationColor()).toBe('#ff00ff');

    saveAnnotationColor(null);
    expect(getAnnotationColor()).toBeNull();
    expect(mockStyles.global).toMatchObject({ color: '#fe01a1', colorSelected: '#fe01a1' });
  });

  it('another window saving or resetting the color updates this one', () => {
    followAnnotationColor();
    localStorage.setItem('annotationColor', '#00ffff');
    window.dispatchEvent(new StorageEvent('storage', { key: 'annotationColor' }));
    expect(mockStyles.global.colorSelected).toBe('#00ffff');

    localStorage.removeItem('annotationColor');
    window.dispatchEvent(new StorageEvent('storage', { key: 'annotationColor' }));
    expect(mockStyles.global.colorSelected).toBe('#fe01a1');
  });
});
