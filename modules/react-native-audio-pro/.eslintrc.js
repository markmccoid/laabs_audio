module.exports = {
	root: true,
	extends: [
		'@react-native',
		'prettier',
		'plugin:import/recommended',
		'plugin:import/typescript',
		'plugin:@typescript-eslint/recommended',
	],
	plugins: ['import', '@typescript-eslint'],
	parser: '@typescript-eslint/parser',
	rules: {
		'react/react-in-jsx-scope': 'off',
		'react-hooks/exhaustive-deps': 'warn',
		'@typescript-eslint/no-require-imports': 'off',
		'prettier/prettier': [
			'error',
			{
				quoteProps: 'consistent',
				singleQuote: true,
				tabWidth: 4,
				trailingComma: 'all',
				useTabs: true,
				printWidth: 100,
			},
		],
		'import/order': [
			'error',
			{
				'groups': [
					'builtin',
					'external',
					'internal',
					['parent', 'sibling'],
					'index',
					'object',
					'type',
				],
				'pathGroups': [
					{
						pattern: 'react',
						group: 'builtin',
						position: 'before',
					},
					{
						pattern: 'react-native',
						group: 'builtin',
						position: 'before',
					},
				],
				'pathGroupsExcludedImportTypes': ['react', 'react-native'],
				'alphabetize': {
					order: 'asc',
					caseInsensitive: true,
				},
				'newlines-between': 'always',
			},
		],
	},
	settings: {
		'import/resolver': {
			typescript: {},
		},
	},
	overrides: [
		{
			files: ['jest.setup.js'],
			env: {
				jest: true,
			},
		},
	],
};
