// source: https://github.com/prettier/prettier/blob/ee2839bacbf6a52d004fa2f0373b732f6f191ccc/tests_config/run_spec.js

import fs from 'fs';
import path from 'path';
import type { Options } from 'prettier';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Dynamic import for prettier
let prettier: typeof import('prettier') | undefined;

interface TestOptions extends Partial<Options> {
	filepath?: string;
	rangeStart?: number;
	rangeEnd?: number;
	cursorOffset?: number;
	printWidth?: number;
}

async function run_spec(
	dirname: string,
	options?: Partial<Options>
): Promise<void> {
	if (!prettier) {
		prettier = await import('prettier');
	}

	const files = fs.readdirSync(dirname);

	for (const filename of files) {
		const filepath = dirname + '/' + filename;
		if (
			path.extname(filename) !== '.snap' &&
			fs.lstatSync(filepath).isFile() &&
			filename[0] !== '.' &&
			filename !== 'jsfmt.spec.ts'
		) {
			let rangeStart = 0;
			let rangeEnd = Infinity;
			let cursorOffset: number | undefined;
			const source = read(filepath)
				.replace(/\r\n/g, '\n')
				.replace('<<<PRETTIER_RANGE_START>>>', (_match, offset) => {
					rangeStart = offset;
					return '';
				})
				.replace('<<<PRETTIER_RANGE_END>>>', (_match, offset) => {
					rangeEnd = offset;
					return '';
				});

			const input = source.replace('<|>', (_match, offset) => {
				cursorOffset = offset;
				return '';
			});

			const mergedOptions: TestOptions = Object.assign(
				mergeDefaultOptions(options || {}),
				{
					filepath,
					rangeStart,
					rangeEnd,
					cursorOffset,
				}
			);

			test(filename, async () => {
				const output = await prettyprint(input, mergedOptions);
				expect(
					raw(
						source +
							'~'.repeat(mergedOptions.printWidth ?? 80) +
							'\n' +
							output
					)
				).toMatchSnapshot();
			});
		}
	}
}

(global as any).run_spec = run_spec;

async function prettyprint(src: string, options: TestOptions): Promise<string> {
	if (!prettier) {
		prettier = await import('prettier');
	}
	const result = await prettier.formatWithCursor(src, options as any);
	if (options.cursorOffset !== undefined && options.cursorOffset >= 0) {
		result.formatted =
			result.formatted.slice(0, result.cursorOffset) +
			'<|>' +
			result.formatted.slice(result.cursorOffset);
	}
	return result.formatted;
}

function read(filename: string): string {
	return fs.readFileSync(filename, 'utf8');
}

interface RawSnapshot {
	[key: symbol]: string;
}

/**
 * Wraps a string in a marker object that is used by `./raw-serializer.ts` to
 * directly print that string in a snapshot without escaping all double quotes.
 * Backticks will still be escaped.
 */
function raw(string: string): RawSnapshot {
	if (typeof string !== 'string') {
		throw new Error('Raw snapshots have to be strings.');
	}
	return { [Symbol.for('raw')]: string };
}

function mergeDefaultOptions(parserConfig: Partial<Options>): TestOptions {
	return Object.assign(
		{
			plugins: [path.join(path.dirname(__dirname), 'src', 'index.ts')],
			printWidth: 80,
		},
		parserConfig
	);
}
