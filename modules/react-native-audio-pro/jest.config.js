module.exports = {
	preset: 'react-native',
	modulePathIgnorePatterns: ['<rootDir>/example/node_modules', '<rootDir>/lib/'],
	setupFilesAfterEnv: ['<rootDir>/jest.setup.js'],
	testMatch: ['**/__tests__/**/*.test.ts?(x)'],
	clearMocks: true,
	resetMocks: true,
};
