export default {
	testEnvironment: 'node',
	collectCoverage: true,
	collectCoverageFrom: ['src/**/*.ts', '!<rootDir>/node_modules/'],
	coverageDirectory: './coverage/',
	coveragePathIgnorePatterns: ['/node_modules/', '/dist/'],
	setupFiles: ['<rootDir>/tests_config/run_spec.ts'],
	snapshotSerializers: ['<rootDir>/tests_config/raw-serializer.cjs'],
	testRegex: 'jsfmt\\.spec\\.ts$|__tests__/.*\\.ts$',
	extensionsToTreatAsEsm: ['.ts'],
	moduleNameMapper: {
		'^(\\.{1,2}/.*)\\.js$': '$1',
	},
	transform: {
		'^.+\\.tsx?$': [
			'ts-jest',
			{
				useESM: true,
				tsconfig: {
					module: 'esnext',
					moduleResolution: 'bundler',
				},
			},
		],
	},
	coverageProvider: 'v8',
	testEnvironmentOptions: {
		customExportConditions: ['node', 'node-addons'],
	},
	watchPlugins: [
		'jest-watch-typeahead/filename',
		'jest-watch-typeahead/testname',
	],
};
