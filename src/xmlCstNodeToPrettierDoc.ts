import { type CstNode, type IToken as Token } from 'chevrotain';
import { doc, type Doc, type Printer } from 'prettier';

const { group, hardline, indent, line, softline } = doc.builders;

const empty: Doc = '';

type PrintFn = Printer<CstNode>['print'];

// Helper function to check if a comment contains prettier-ignore directive
function isPrettierIgnoreComment(comment: Token): string | null {
	const content = comment.image.trim();
	// Check for both XML comment style <!-- prettier-ignore --> and shorter variations
	if (content.includes('prettier-ignore')) {
		return content;
	}
	return null;
}

// Helper function to extract original text for a node from the source
function getOriginalText(node: CstNode, options: any): string {
	const location = node.location;
	if (!location) return '';

	// Get the original text from options
	const originalText = options.originalText || options.text;
	if (typeof originalText === 'string') {
		const start = location.startOffset;
		const end = location.endOffset ?? location.startOffset;
		return originalText.slice(start, end + 1);
	}

	// Fallback: try to reconstruct from the tokens within this node
	return '<!-- Unable to preserve original formatting -->';
}

const xmlCstNodeToPrettierDoc: PrintFn = (path, options, _print): Doc => {
	const cst = path.node;

	const elements = cst.children?.element as CstNode[];
	if (!elements || elements.length === 0) {
		return empty;
	}

	return [convertElement(elements[0]!, options, false, false), hardline];
};

export default xmlCstNodeToPrettierDoc;

// Helper function to determine if an element needs wrapping due to long attributes
function elementNeedsWrapping(element: CstNode): boolean {
	const children = element.children;
	if (!children) return false;

	const elementName = (children.Name as Token[])?.[0]?.image || '';
	const attributes = children.attribute as CstNode[];

	if (!attributes || attributes.length === 0) return false;

	// Calculate approximate line length for this element
	let estimatedLength = elementName.length + 2; // < and >

	for (const attr of attributes) {
		const attrChildren = attr.children;
		if (!attrChildren) continue;

		const nameTokens = attrChildren.Name as Token[];
		const stringTokens = attrChildren.STRING as Token[];

		if (nameTokens && stringTokens) {
			const attrName = nameTokens[0]?.image || '';
			const attrValue = stringTokens[0]?.image || '';
			estimatedLength += attrName.length + attrValue.length + 2; // = and space
		}
	}

	// Use a more conservative line length threshold (120 characters)
	// and require multiple attributes or a very long single attribute
	const hasMultipleAttributes = attributes.length > 1;
	const hasVeryLongAttribute = attributes.some((attr) => {
		const attrChildren = attr.children;
		if (!attrChildren) return false;
		const stringTokens = attrChildren.STRING as Token[];
		return (stringTokens?.[0]?.image?.length ?? 0) > 60;
	});

	return (
		estimatedLength > 120 ||
		(hasMultipleAttributes && estimatedLength > 80) ||
		hasVeryLongAttribute
	);
}

function convertElement(
	element: CstNode,
	options: any,
	shouldIgnore: boolean = false,
	forceWrap: boolean = false,
): Doc {
	const children = element.children;
	if (!children) {
		return empty;
	}

	// If we should ignore this element, return its original text
	if (shouldIgnore) {
		return getOriginalText(element, options);
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
			? convertAttributes(attributes, forceWrap)
			: null;

	// Check if self-closing
	const isSelfClosing = !!(children.SLASH_CLOSE as Token[]);

	if (isSelfClosing) {
		if (attrDoc === null) {
			return `<${elementName} />`;
		} else if (forceWrap) {
			return group([`<${elementName}`, attrDoc, hardline, '/>']);
		} else {
			return group([`<${elementName}`, attrDoc, line, '/>']);
		}
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
				type: 'element' | 'comment' | 'chardata' | 'reference';
			}> = []; // Collect all items
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
			if (contentChildren.reference) {
				for (const reference of contentChildren.reference as CstNode[]) {
					items.push({
						offset: reference.location!.startOffset,
						node: reference,
						type: 'reference',
					});
				}
			}

			// Sort by offset
			items.sort((a, b) => a.offset - b.offset);

			// Group adjacent elements and determine if any group needs wrapping
			const elementGroups: Array<{
				items: Array<{
					offset: number;
					node: CstNode | Token;
					type: 'element' | 'comment' | 'chardata' | 'reference';
				}>;
				shouldForceWrap: boolean;
			}> = [];

			let currentGroup: Array<{
				offset: number;
				node: CstNode | Token;
				type: 'element' | 'comment' | 'chardata' | 'reference';
			}> = [];

			// First pass: group adjacent elements
			for (let i = 0; i < items.length; i++) {
				const item = items[i]!;

				if (item.type === 'element') {
					currentGroup.push(item);
				} else {
					// Non-element items end the current group ONLY if it's not text/reference content
					if (currentGroup.length > 0) {
						// Check if any element in this group needs wrapping
						const shouldForceWrap = currentGroup.some(
							(groupItem) => {
								const element = groupItem.node as CstNode;
								return elementNeedsWrapping(element);
							},
						);

						elementGroups.push({
							items: [...currentGroup],
							shouldForceWrap,
						});
						currentGroup = [];
					}

					// Process non-element item immediately, but group consecutive text/reference items together
					if (item.type === 'chardata' || item.type === 'reference') {
						const textGroup = [item];
						let j = i + 1;

						// Collect consecutive chardata/reference items
						while (
							j < items.length &&
							(items[j]!.type === 'chardata' ||
								items[j]!.type === 'reference')
						) {
							textGroup.push(items[j]!);
							j++;
						}

						elementGroups.push({
							items: textGroup,
							shouldForceWrap: false,
						});

						// Skip the items we've processed
						i = j - 1;
					} else {
						// Comment or other non-element item
						elementGroups.push({
							items: [item],
							shouldForceWrap: false,
						});
					}
				}
			}

			// Handle any remaining group
			if (currentGroup.length > 0) {
				const shouldForceWrap = currentGroup.some((groupItem) => {
					const element = groupItem.node as CstNode;
					return elementNeedsWrapping(element);
				});

				elementGroups.push({
					items: [...currentGroup],
					shouldForceWrap,
				});
			}

			// Process groups
			let nextElementShouldIgnore = false;

			for (const group of elementGroups) {
				for (let i = 0; i < group.items.length; i++) {
					const item = group.items[i]!;

					if (item.type === 'element') {
						// Check if this element is adjacent to a previous element
						const isAdjacentToElement =
							i > 0 && group.items[i - 1]!.type === 'element';

						// Only add softline if this is not adjacent to another element
						if (!isAdjacentToElement) {
							contentParts.push(softline);
						}
						contentParts.push(
							convertElement(
								item.node as CstNode,
								options,
								nextElementShouldIgnore,
								group.shouldForceWrap,
							),
						);
						// Reset the ignore flag after using it
						nextElementShouldIgnore = false;
					} else if (item.type === 'comment') {
						const commentToken = item.node as Token;
						// Check if this comment is adjacent to a previous element
						const isAdjacentToElement =
							i > 0 && group.items[i - 1]!.type === 'element';

						// Only add softline if this is not adjacent to another element
						if (!isAdjacentToElement) {
							contentParts.push(softline);
						}
						contentParts.push(commentToken.image);

						// Check if this comment is a prettier-ignore directive
						if (isPrettierIgnoreComment(commentToken)) {
							nextElementShouldIgnore = true;
						}
					} else if (
						item.type === 'chardata' ||
						item.type === 'reference'
					) {
						// Collect consecutive chardata and reference nodes into a text run
						const textRun: string[] = [];
						let j = i;

						while (
							j < group.items.length &&
							(group.items[j]!.type === 'chardata' ||
								group.items[j]!.type === 'reference')
						) {
							const currentItem = group.items[j]!;

							if (currentItem.type === 'chardata') {
								const chardata = currentItem.node as CstNode;
								const rawText =
									extractRawTextFromChardata(chardata);
								if (rawText !== null) {
									textRun.push(rawText);
								}
							} else if (currentItem.type === 'reference') {
								const reference = currentItem.node as CstNode;
								const refText =
									extractTextFromReference(reference);
								if (refText) {
									textRun.push(refText);
								}
							}

							j++;
						}

						// Process the complete text run
						if (textRun.length > 0) {
							const fullText = textRun.join('');
							const trimmed = fullText.trim();

							if (trimmed) {
								// Normalize whitespace while preserving entity references
								const normalized = fullText
									.split('\n')
									.map((line) => line.trim())
									.join(' ')
									.trim();

								contentParts.push(softline);
								contentParts.push(normalized);
							} else if (
								i < group.items.length &&
								group.items[i]!.type === 'chardata' &&
								checkForEmptyLine(
									group.items[i]!.node as CstNode,
								)
							) {
								// Preserve empty line
								contentParts.push(hardline);
							}
						}

						// Skip the items we've already processed
						i = j - 1;
					}
				}
			}
		}
	}

	const openTag =
		attrDoc === null
			? `<${elementName}>`
			: forceWrap
				? group([`<${elementName}`, attrDoc, hardline, '>'])
				: group([`<${elementName}`, attrDoc, softline, '>']);

	const closeTag = `</${elementName}>`;

	// Elements with content should not try to fit on one line
	return contentParts.length > 0
		? [openTag, indent(contentParts), softline, closeTag]
		: group([openTag, indent(contentParts), softline, closeTag]);
}

function extractTextFromReference(reference: CstNode): string | null {
	const children = reference.children;
	if (!children) return null;

	// Get entity or character reference
	const entityRef = (children.EntityRef as Token[]) || [];
	const charRef = (children.CharRef as Token[]) || [];

	const allRefs = [...entityRef, ...charRef];
	if (allRefs.length === 0) return null;

	// Return the entity/char reference as-is (e.g., "&amp;", "&#38;")
	return allRefs[0]!.image;
}

function extractRawTextFromChardata(chardata: CstNode): string | null {
	const children = chardata.children;
	if (!children) return null;

	// Get text content from TEXT or SEA_WS tokens
	const textTokens = (children.TEXT as Token[]) || [];
	const wsTokens = (children.SEA_WS as Token[]) || [];

	const allTokens = [...textTokens, ...wsTokens];
	if (allTokens.length === 0) return null;

	// Return raw text without any normalization
	return allTokens.map((t) => t.image).join('');
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

function convertAttributes(
	attributes: CstNode[],
	forceWrap: boolean = false,
): Doc {
	const parts: Doc[] = [];
	let first = true;

	// Determine if we should wrap based on forceWrap or natural length
	let shouldWrap = forceWrap;
	if (!shouldWrap) {
		// Calculate total length to decide if wrapping is needed
		let totalLength = 0;
		for (const attr of attributes) {
			const attrChildren = attr.children;
			if (!attrChildren) continue;

			const nameTokens = attrChildren.Name as Token[];
			const stringTokens = attrChildren.STRING as Token[];

			if (nameTokens && stringTokens) {
				const attrName = nameTokens[0]?.image || '';
				const attrValue = stringTokens[0]?.image || '';
				totalLength += attrName.length + attrValue.length + 2; // = and space
			}
		}
		// More conservative threshold for natural wrapping (100 characters)
		shouldWrap = totalLength > 100;
	}

	for (const attr of attributes) {
		const attrChildren = attr.children;
		if (!attrChildren) continue;

		const nameTokens = attrChildren.Name as Token[];
		const stringTokens = attrChildren.STRING as Token[];

		if (!nameTokens || !stringTokens) continue;

		const attrName = nameTokens[0]!.image;
		const attrValue = stringTokens[0]!.image;

		if (!first) {
			parts.push(shouldWrap ? hardline : line);
		} else {
			first = false;
		}

		const value = convertAttributeValue(attrValue, attrName);
		parts.push(group([`${attrName}=`, value]));
	}

	if (shouldWrap) {
		return [indent([' ', hardline, ...parts])];
	} else {
		return [indent([' ', softline, ...parts])];
	}
}

function convertAttributeValue(value: string, attrName: string): Doc {
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
	if (attrName.toLowerCase() === 'class') {
		const words = content.split(/\s+/);
		if (words.length > 1 && content.length > 40) {
			return group([
				quote,
				indent([
					softline,
					...words.flatMap((w) => [w, line]).slice(0, -1),
				]),
				softline,
				quote,
			]);
		}
	} else {
		return [quote, content, quote];
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
					i < parts.length - 1 ? [p, ',', line] : [p],
				),
		]),
		softline,
		'}',
	]);
}
