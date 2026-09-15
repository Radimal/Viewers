const base = require('../../jest.config.base.js');

module.exports = {
  ...base,
  moduleNameMapper: {
    ...base.moduleNameMapper,
    // Deep imports (`@ohif/core/src/...`) must map before the generic package
    // pattern, which would otherwise append a second `/src`.
    '@ohif/core/src/(.*)': '<rootDir>/../../platform/core/src/$1',
    '@ohif/(.*)': '<rootDir>/../../platform/$1/src',
  },
  // rootDir: "../.."
  // testMatch: [
  //   //`<rootDir>/platform/${pack.name}/**/*.spec.js`
  //   "<rootDir>/platform/app/**/*.test.js"
  // ]
};
