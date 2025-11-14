import { type CstNode, type IToken as Token } from 'chevrotain';
import { doc, type Doc, type Printer } from 'prettier';

const { group, hardline, indent, line, softline } = doc.builders;

const empty: Doc = '';

type PrintFn = Printer<CstNode>['print'];

const xmlCstNodeToPrettierDoc: PrintFn = (path, _options, _print): Doc => {
	const cst = path.node;

	const elements = cst.children?.element as CstNode[];
	if (!elements || elements.length === 0) {
		return empty;
	}

	return [convertElement(elements[0]!), hardline];
};

export default xmlCstNodeToPrettierDoc;

function convertElement(element: CstNode): Doc {
	const children = element.children;
	if (!children) {
		return empty;
	}

	// Get element name
	const nameTokens = children.Name as Token[];
	if (!nameTokens || nameTokens.length === 0) {
		throw new Error('Expected element name');
	}
	const elementName = nameTokens[0]!.image;

	// Get attributes
	const attributes = children.attribute as CstNode[];
	const attrDoc =
		attributes && attributes.length > 0
			? convertAttributes(attributes)
			: null;

	// Check if self-closing
	const isSelfClosing = !!(children.SLASH_CLOSE as Token[]);

	if (isSelfClosing) {
		return attrDoc === null
			? `<${elementName} />`
			: group([`<${elementName}`, attrDoc, line, '/>']);
	}

	// Get content
	const contentNodes = children.content as CstNode[];
	const contentParts: Doc[] = [];

	if (contentNodes && contentNodes.length > 0) {
		for (const contentNode of contentNodes) {
			const contentChildren = contentNode.children;
			if (!contentChildren) continue;

			// Process content children in order by their start offset
			const items: Array<{
				offset: number;
				node: CstNode | Token;
				type: 'element' | 'comment' | 'chardata';
			}> = [];

			// Collect all items
			if (contentChildren.element) {
				for (const el of contentChildren.element as CstNode[]) {
					items.push({
						offset: el.location!.startOffset,
						node: el,
						type: 'element',
					});
				}
			}
			if (contentChildren.Comment) {
				for (const comment of contentChildren.Comment as Token[]) {
					items.push({
						offset: comment.startOffset,
						node: comment,
						type: 'comment',
					});
				}
			}
			if (contentChildren.chardata) {
				for (const chardata of contentChildren.chardata as CstNode[]) {
					items.push({
						offset: chardata.location!.startOffset,
						node: chardata,
						type: 'chardata',
					});
				}
			}

			// Sort by offset
			items.sort((a, b) => a.offset - b.offset);

			// Process items
			for (const item of items) {
				if (item.type === 'element') {
					contentParts.push(softline);
					contentParts.push(convertElement(item.node as CstNode));
				} else if (item.type === 'comment') {
					contentParts.push(softline);
					contentParts.push((item.node as Token).image);
				} else if (item.type === 'chardata') {
					const chardata = item.node as CstNode;
					const textContent = extractTextFromChardata(chardata);

					if (textContent) {
						contentParts.push(softline);
						contentParts.push(textContent);
					} else if (checkForEmptyLine(chardata)) {
						// Preserve empty line (multiple newlines in source)
						contentParts.push(hardline);
					}
					// Note: Other whitespace-only chardata is skipped
				}
			}
		}
	}

	const openTag =
		attrDoc === null
			? `<${elementName}>`
			: group([`<${elementName}`, attrDoc, softline, '>']);

	const closeTag = `</${elementName}>`;

	// Elements with content should not try to fit on one line
	return contentParts.length > 0
		? [openTag, indent(contentParts), softline, closeTag]
		: group([openTag, indent(contentParts), softline, closeTag]);
}

function extractTextFromChardata(chardata: CstNode): string | null {
	const children = chardata.children;
	if (!children) return null;

	// Get text content from TEXT or SEA_WS tokens
	const textTokens = (children.TEXT as Token[]) || [];
	const wsTokens = (children.SEA_WS as Token[]) || [];

	const allTokens = [...textTokens, ...wsTokens];
	if (allTokens.length === 0) return null;

	// Combine all text
	const text = allTokens.map((t) => t.image).join('');
	const trimmed = text.trim();

	if (!trimmed) return null;

	// Normalize whitespace - join multiple lines into a single line
	return trimmed
		.split('\n')
		.map((line) => line.trim())
		.join(' ');
}

function checkForEmptyLine(chardata: CstNode): boolean {
	const children = chardata.children;
	if (!children) return false;

	// Get text content from TEXT or SEA_WS tokens
	const textTokens = (children.TEXT as Token[]) || [];
	const wsTokens = (children.SEA_WS as Token[]) || [];

	const allTokens = [...textTokens, ...wsTokens];
	if (allTokens.length === 0) return false;

	// Combine all text
	const text = allTokens.map((t) => t.image).join('');

	// Check if there are multiple newlines (indicates empty line)
	const newlineCount = (text.match(/\n/g) || []).length;
	return newlineCount >= 2;
}

function convertAttributes(attributes: CstNode[]): Doc {
	const parts: Doc[] = [];
	let first = true;

	for (const attr of attributes) {
		const attrChildren = attr.children;
		if (!attrChildren) continue;

		const nameTokens = attrChildren.Name as Token[];
		const stringTokens = attrChildren.STRING as Token[];

		if (!nameTokens || !stringTokens) continue;

		const attrName = nameTokens[0]!.image;
		const attrValue = stringTokens[0]!.image;

		if (!first) {
			parts.push(line);
		} else {
			first = false;
		}

		const value = convertAttributeValue(attrValue);
		parts.push(group([`${attrName}=`, value]));
	}

	return [indent([' ', softline, ...parts])];
}

function convertAttributeValue(value: string): Doc {
	// Remove quotes
	const match = /^(['"])(.+)\1$/s.exec(value);
	if (!match) {
		return value;
	}

	const quote = match[1]!;
	const content = match[2]!;

	// Check if it's a binding expression
	const bindingMatch = /^(\{.+\})$/s.exec(content);
	if (bindingMatch) {
		return [quote, parseBindingThings(content, 0), quote];
	}

	// For regular attribute values, check if they should be split
	// Split on whitespace for long values
	const words = content.split(/\s+/);
	if (words.length > 1 && content.length > 40) {
		return group([
			quote,
			indent([softline, ...words.flatMap((w) => [w, line]).slice(0, -1)]),
			softline,
			quote,
		]);
	}

	return value;
}

// Parses a string of the form {Ctor arg1=val1, arg2=val2, ...} and produces a DocTree
// handles values that are nested bindings themselves
function parseBindingThings(str: string, head: number): Doc {
	let pos = head;

	if (str[head] !== '{') {
		return str;
	}

	pos++; // skip {

	let ctor = '';
	while (pos < str.length && /[a-zA-Z0-9_:]/.test(str[pos]!)) {
		ctor += str[pos];
		pos++;
	}

	// Skip whitespace
	while (pos < str.length && /\s/.test(str[pos]!)) {
		pos++;
	}

	// Splits on commas that are not inside nested {}
	const parts: string[] = [];
	let currentPart = '';
	let braceLevel = 0;

	while (pos < str.length) {
		const char = str[pos];

		if (char === '{') {
			braceLevel++;
		} else if (char === '}') {
			if (braceLevel === 0) {
				break;
			}
			braceLevel--;
		} else if (char === ',' && braceLevel === 0) {
			parts.push(currentPart.trim());
			currentPart = '';
			pos++;
			continue;
		}

		currentPart += char;
		pos++;
	}

	if (currentPart.trim() !== '') {
		parts.push(currentPart.trim());
	}

	// Check if we should wrap based on length
	// If there are multiple parts (comma-separated), we should wrap
	// For single parts, we wrap based on line length fitting
	const hasMultipleParts = parts.length > 1;

	if (parts.length === 0) {
		return [`{${ctor}`, softline, '}'];
	}

	if (!hasMultipleParts) {
		// Single argument binding - always force wrapping
		return [`{${ctor}`, indent([line, parts[0]!]), softline, '}'];
	}

	// Multiple parts - use group to let it decide whether to wrap
	return group([
		`{${ctor} `,
		indent([
			softline,
			...parts
				.map((part) => {
					if (part.includes('={')) {
						const eqIndex = part.indexOf('=');
						const key = part.substring(0, eqIndex);
						const value = part.substring(eqIndex + 1);
						return group([key, '=', parseBindingThings(value, 0)]);
					} else {
						return part;
					}
				})
				.flatMap((p, i) =>
					i < parts.length - 1 ? [p, ',', line] : [p]
				),
		]),
		softline,
		'}',
	]);
}
