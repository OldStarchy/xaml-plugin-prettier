import { parse as xmlToolsParse } from "@xml-tools/parser";

function createError(message, options) {
  // TODO: Use `Error.prototype.cause` when we drop support for Node.js<18.7.0

  // Construct an error similar to the ones thrown by Prettier.
  const error = new SyntaxError(
    message +
      " (" +
      options.loc.start.line +
      ":" +
      options.loc.start.column +
      ")"
  );

  return Object.assign(error, options);
}

// Parses a string of the form {Ctor arg1=val1, arg2=val2, ...} and produces a DocTree
// handles values that are nested bindings themselves
function parseObjectSyntax(str) {
  let pos = 0;

  if (str[pos] !== "{") {
    return str;
  }

  pos++; // skip {

  let ctor = "";
  while (pos < str.length && /[a-zA-Z0-9_:]/.test(str[pos])) {
    ctor += str[pos];
    pos++;
  }

  // Skip whitespace
  while (pos < str.length && /\s/.test(str[pos])) {
    pos++;
  }

  // Splits on commas that are not inside nested {}
  const parts = [];
  let currentPart = "";
  let braceLevel = 0;

  while (pos < str.length) {
    const char = str[pos];

    if (char === "{") {
      braceLevel++;
    } else if (char === "}") {
      if (braceLevel === 0) {
        break;
      }
      braceLevel--;
    } else if (char === "," && braceLevel === 0) {
      parts.push(currentPart.trim());
      currentPart = "";
      pos++;
      continue;
    }

    currentPart += char;
    pos++;
  }

  if (currentPart.trim() !== "") {
    parts.push(currentPart.trim());
  }

  // Check if we should wrap based on length
  // If there are multiple parts (comma-separated), we should wrap
  // For single parts, we wrap based on line length fitting
  const hasMultipleParts = parts.length > 1;

  if (parts.length === 0) {
    return { ctor };
  }

  const partNodes = parts.map((part) => {
    if (!part.includes("={")) {
      return part;
    }

    const eqIndex = part.indexOf("=");
    const key = part.substring(0, eqIndex);
    const value = part.substring(eqIndex + 1);
    return { Name: key, EQUALS: "=", Value: parseObjectSyntax(value) };
  });

  return { ctor, parts: partNodes, hasMultipleParts };
}

function parseAttributeValue(value) {
  if (/^"\{[^"]*\}"$|^'\{[^']*\}'$/.test(value)) {
    return parseObjectSyntax(value.slice(1, -1));
  }

  return null;
}

function simplifyCST(node) {
  switch (node.name) {
    case "attribute": {
      const { Name, EQUALS, STRING } = node.children;

      return {
        name: "attribute",
        Name: Name[0].image,
        EQUALS: EQUALS[0].image,
        STRING: STRING[0].image,
        ObjectConstructor: parseAttributeValue(STRING[0].image),
        location: node.location
      };
    }
    case "chardata": {
      const { SEA_WS, TEXT } = node.children;

      return {
        name: "chardata",
        SEA_WS: SEA_WS ? SEA_WS[0].image : null,
        TEXT: TEXT ? TEXT[0].image : null,
        location: node.location
      };
    }
    case "content": {
      const {
        CData,
        Comment,
        chardata,
        element,
        PROCESSING_INSTRUCTION,
        reference
      } = node.children;

      return {
        name: "content",
        CData: CData || [],
        Comment: Comment || [],
        chardata: (chardata || []).map(simplifyCST),
        element: (element || []).map(simplifyCST),
        PROCESSING_INSTRUCTION: PROCESSING_INSTRUCTION || [],
        reference: (reference || []).map(simplifyCST),
        location: node.location
      };
    }
    case "docTypeDecl": {
      const { DocType, Name, externalID, CLOSE } = node.children;

      return {
        name: "docTypeDecl",
        DocType: DocType[0].image,
        Name: Name[0].image,
        externalID: externalID ? simplifyCST(externalID[0]) : null,
        CLOSE: CLOSE[0].image,
        location: node.location
      };
    }
    case "document": {
      const { docTypeDecl, element, misc, prolog } = node.children;

      return {
        name: "document",
        docTypeDecl: docTypeDecl ? simplifyCST(docTypeDecl[0]) : null,
        element: element ? simplifyCST(element[0]) : null,
        misc: (misc || [])
          .filter((child) => !child.children.SEA_WS)
          .map(simplifyCST),
        prolog: prolog ? simplifyCST(prolog[0]) : null,
        location: node.location
      };
    }
    case "element": {
      const {
        OPEN,
        Name,
        attribute,
        START_CLOSE,
        content,
        SLASH_OPEN,
        END_NAME,
        END,
        SLASH_CLOSE
      } = node.children;

      return {
        name: "element",
        OPEN: OPEN[0].image,
        Name: Name[0].image,
        attribute: (attribute || []).map(simplifyCST),
        START_CLOSE: START_CLOSE ? START_CLOSE[0].image : null,
        content: content ? simplifyCST(content[0]) : null,
        SLASH_OPEN: SLASH_OPEN ? SLASH_OPEN[0].image : null,
        END_NAME: END_NAME ? END_NAME[0].image : null,
        END: END ? END[0].image : null,
        SLASH_CLOSE: SLASH_CLOSE ? SLASH_CLOSE[0].image : null,
        location: node.location
      };
    }
    case "externalID": {
      const { Public, PubIDLiteral, System, SystemLiteral } = node.children;

      return {
        name: "externalID",
        Public: Public ? Public[0].image : null,
        PubIDLiteral: PubIDLiteral ? PubIDLiteral[0].image : null,
        System: System ? System[0].image : null,
        SystemLiteral: SystemLiteral ? SystemLiteral[0].image : null,
        location: node.location
      };
    }
    case "misc": {
      const { Comment, PROCESSING_INSTRUCTION, SEA_WS } = node.children;

      return {
        name: "misc",
        Comment: Comment ? Comment[0].image : null,
        PROCESSING_INSTRUCTION: PROCESSING_INSTRUCTION
          ? PROCESSING_INSTRUCTION[0].image
          : null,
        SEA_WS: SEA_WS ? SEA_WS[0].image : null,
        location: node.location
      };
    }
    case "prolog": {
      const { XMLDeclOpen, attribute, SPECIAL_CLOSE } = node.children;

      return {
        name: "prolog",
        XMLDeclOpen: XMLDeclOpen[0].image,
        attribute: (attribute || []).map(simplifyCST),
        SPECIAL_CLOSE: SPECIAL_CLOSE[0].image,
        location: node.location
      };
    }
    case "reference": {
      const { CharRef, EntityRef } = node.children;

      return {
        name: "reference",
        CharRef: CharRef ? CharRef[0].image : null,
        EntityRef: EntityRef ? EntityRef[0].image : null,
        location: node.location
      };
    }
    default:
      throw new Error(`Unknown node type: ${node.name}`);
  }
}

const parser = {
  parse(text) {
    const { lexErrors, parseErrors, cst } = xmlToolsParse(text);

    // If there are any lexical errors, throw the first of them as an error.
    if (lexErrors.length > 0) {
      const lexError = lexErrors[0];
      throw createError(lexError.message, {
        loc: {
          start: { line: lexError.line, column: lexError.column },
          end: {
            line: lexError.line,
            column: lexError.column + lexError.length
          }
        }
      });
    }

    // If there are any parse errors, throw the first of them as an error.
    if (parseErrors.length > 0) {
      const parseError = parseErrors[0];
      throw createError(parseError.message, {
        loc: {
          start: {
            line: parseError.token.startLine,
            column: parseError.token.startColumn
          },
          end: {
            line: parseError.token.endLine,
            column: parseError.token.endColumn
          }
        }
      });
    }

    // Otherwise return the CST.
    return simplifyCST(cst);
  },
  astFormat: "xaml",
  locStart(node) {
    return node.location.startOffset;
  },
  locEnd(node) {
    return node.location.endOffset;
  }
};

export default parser;
