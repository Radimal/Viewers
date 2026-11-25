import viewCode from './viewCode';

describe('viewCode', () => {
  it('reads the first view code', () => {
    const displaySet = {
      images: [{ ViewCodeSequence: [{ CodingSchemeDesignator: 'SRT', CodeValue: 'R-10224' }] }],
    };
    expect(viewCode(displaySet)).toBe('SRT:R-10224');
  });

  it('is undefined when the image has no ViewCodeSequence, as on most vet X-rays', () => {
    expect(viewCode({ images: [{}] })).toBeUndefined();
  });

  it('is undefined for a display set without images', () => {
    expect(viewCode({})).toBeUndefined();
  });
});
