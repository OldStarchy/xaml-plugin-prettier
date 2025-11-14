import { parse } from '@xml-tools/parser';
import { type CstNode } from 'chevrotain';
import {
	type Options,
	type Parser,
	type Printer,
	type SupportLanguage,
} from 'prettier';
import xmlCstNodeToPrettierDoc from './xmlCstNodeToPrettierDoc.js';

const PARSER_KEY = '@xml-tools/parser';
const AST_FORMAT_KEY = '@xml-tools/parser';

export const languages: SupportLanguage[] = [
	{
		name: 'XAML',
		parsers: [PARSER_KEY],
		extensions: ['.xaml'],
		vscodeLanguageIds: ['xaml'],
	},
];

const XamlParser: Parser<
	CstNode & { location: Exclude<CstNode['location'], undefined> }
> = {
	parse: async (text, _options) => {
		// Since we already have a CST to DocTree converter, we can leverage it here.
		const { cst } = parse(text);

		return cst as CstNode & {
			location: Exclude<CstNode['location'], undefined>;
		};
	},
	astFormat: AST_FORMAT_KEY,
	locStart: (node) => node.location.startOffset,
	locEnd: (node) => node.location.endOffset ?? node.location.startOffset,
};

export const parsers: Record<typeof PARSER_KEY, Parser> = {
	[PARSER_KEY]: XamlParser,
};

const XamlPrinter: Printer<CstNode> = {
	print: (path, options, print) => {
		return xmlCstNodeToPrettierDoc(path, options, print);
	},
};

export const printers: Record<typeof AST_FORMAT_KEY, Printer> = {
	[AST_FORMAT_KEY]: XamlPrinter,
};

export const options = {};
export const defaultOptions: Options = {};
