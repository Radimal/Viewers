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

import { applyAnnotationColor, saveAnnotationColor, getAnnotationColor } from './annotationColor';

describe('annotationColor', () => {
  beforeEach(() => localStorage.clear());

  it('leaves the default yellow/green alone for readers who never picked a color', () => {
    applyAnnotationColor();
    expect(mockStyles.global.colorSelected).toBe('rgb(0, 220, 0)');
  });

  it('a pick colors every state and survives a reload; reset restores the defaults', () => {
    saveAnnotationColor('#ff00ff');
    expect(mockStyles.global).toMatchObject({
      color: '#ff00ff',
      colorSelected: '#ff00ff',
      textBoxColorHighlighted: '#ff00ff',
      lineWidth: '1.5',
    });
    expect(getAnnotationColor()).toBe('#ff00ff');

    saveAnnotationColor(null);
    expect(getAnnotationColor()).toBeNull();
    expect(mockStyles.global).toMatchObject({
      color: 'rgb(255, 255, 0)',
      colorSelected: 'rgb(0, 220, 0)',
    });
  });
});
