var traceur = require('traceur');

var ParseTreeTransformer = traceur.get('codegeneration/ParseTreeTransformer.js').ParseTreeTransformer;
var ScopeTransformer = traceur.get('codegeneration/ScopeTransformer.js').ScopeTransformer;


var Script = traceur.get('syntax/trees/ParseTrees.js').Script;
var parseStatements = traceur.get('codegeneration/PlaceholderParser.js').parseStatements;
var STRING = traceur.get('syntax/TokenType.js').STRING;
var LiteralExpression = traceur.get('syntax/trees/ParseTrees.js').LiteralExpression;
var LiteralToken = traceur.get('syntax/LiteralToken.js').LiteralToken;


module.exports = function(source, format) {
  var output = {
    requires: [],
    format: format,
    usesBuffer: false 
  };

  var tree, compiler, transformer;

  // detect register
  if (!output.format) {
    var leadingCommentAndMetaRegEx = /^\s*(\/\*[^\*]*(\*(?!\/)[^\*]*)*\*\/|\s*\/\/[^\n]*|\s*"[^"]+"\s*;?|\s*'[^']+'\s*;?)*\s*/;
    var leadingCommentAndMeta = source.match(leadingCommentAndMetaRegEx);
    if (leadingCommentAndMeta && source.substr(leadingCommentAndMeta[0].length, 15) == 'System.register')
      output.format = 'register';
  }

  // esm
  if (!output.format) {
    try {
      compiler = new traceur.Compiler({ script: false });
      tree = compiler.parse(source);
      transformer = new ESMDetectionTransformer();
      transformer.transformAny(tree);
      if (transformer.isESModule)
        output.format = 'esm';
      else
        compiler = tree = undefined;
    }
    catch(e) {
      compiler = tree = undefined;
    }
  }

  // cjs
  if (!output.format) {
    var cjsRequireRegEx = /(?:^\uFEFF?|[^$_a-zA-Z\xA0-\uFFFF."'])require\s*\(\s*("[^"\\]*(?:\\.[^"\\]*)*"|'[^'\\]*(?:\\.[^'\\]*)*')\s*\)/g;
    var cjsExportsRegEx = /(?:^\uFEFF?|[^$_a-zA-Z\xA0-\uFFFF.])(exports\s*(\[['"]|\.)|module(\.exports|\['exports'\]|\["exports"\])\s*(\[['"]|[=,\.]))/;
    if (source.match(cjsRequireRegEx) || source.match(cjsExportsRegEx))
      output.format = 'cjs';
  }

  // amd
  if (!output.format) {
    var amdRegEx = /(?:^\uFEFF?|[^$_a-zA-Z\xA0-\uFFFF.])define\s*\(\s*("[^"]+"\s*,\s*|'[^']+'\s*,\s*)?\s*(\[(\s*(("[^"]+"|'[^']+')\s*,|\/\/.*\r?\n|\/\*(.|\s)*?\*\/))*(\s*("[^"]+"|'[^']+')\s*,?)?(\s*(\/\/.*\r?\n|\/\*(.|\s)*?\*\/))*\s*\]|function\s*|{|[_$a-zA-Z\xA0-\uFFFF][_$a-zA-Z0-9\xA0-\uFFFF]*\))/;
    if (source.match(amdRegEx))
      output.format = 'amd';
  }

  // fallback is cjs
  if (!output.format)
    output.format = 'cjs';

  // CJS Buffer detection and require extraction
  if (output.format == 'cjs') {
    try {
      compiler = new traceur.Compiler({ script: true });
      tree = tree || compiler.parse(source);
    }
    catch(e) {
      return output;
    }

    // sets output.requires
    transformer = new CJSDepsTransformer();
    try {
      transformer.transformAny(tree);
    }
    catch(e) {}
    output.requires = transformer.requires;

    // sets output.usesBuffer
    transformer = new GlobalUsageTransformer('Buffer');
    try {
      transformer.transformAny(tree);
    }
    catch(e) {}
    output.usesBuffer = !!transformer.usesGlobal;
  }

  // ESM require extraction
  else if (output.format == 'esm') {
    try {
      compiler = new traceur.Compiler({ script: false })
      tree = tree || compiler.parse(source);
    }
    catch(e) {
      return output;
    }

    transformer = new ESMImportsTransformer();
    try {
      transformer.transformAny(tree);
    }
    catch(e) {}
    output.requires = transformer.imports;
  }
  
  return output;
};

function ESMDetectionTransformer() {
  this.isESModule = false;
  return ParseTreeTransformer.apply(this, arguments);
}
ESMDetectionTransformer.prototype = Object.create(ParseTreeTransformer.prototype);
ESMDetectionTransformer.prototype.transformExportDeclaration = function(tree) {
  this.isESModule = true;
  return ParseTreeTransformer.prototype.transformExportDeclaration.call(this, tree);
};
ESMDetectionTransformer.prototype.transformImportDeclaration = function(tree) {
  this.isESModule = true;
  return ParseTreeTransformer.prototype.transformImportDeclaration.call(this, tree);
};

function ESMImportsTransformer() {
  this.imports = [];
  return ParseTreeTransformer.apply(this, arguments);
}
ESMImportsTransformer.prototype = Object.create(ParseTreeTransformer.prototype);
ESMImportsTransformer.prototype.transformModuleSpecifier = function(tree) {
  if (this.imports.indexOf(tree.token.processedValue) == -1)
    this.imports.push(tree.token.processedValue);

  return ParseTreeTransformer.prototype.transformModuleSpecifier.call(this, tree);
};


function CJSDepsTransformer() {
  this.requires = [];
  return ParseTreeTransformer.apply(this, arguments);
}
CJSDepsTransformer.prototype = Object.create(ParseTreeTransformer.prototype);

CJSDepsTransformer.prototype.transformCallExpression = function(tree) {
  if (!tree.operand.identifierToken || tree.operand.identifierToken.value != 'require')
    return ParseTreeTransformer.prototype.transformCallExpression.call(this, tree);

  // found a require
  var args = tree.args.args;
  if (args.length && args[0].type == 'LITERAL_EXPRESSION' && args.length == 1) {
    if (this.requires.indexOf(args[0].literalToken.processedValue) == -1)
      this.requires.push(args[0].literalToken.processedValue);
  }

  return ParseTreeTransformer.prototype.transformCallExpression.call(this, tree);
};

function GlobalUsageTransformer(varName) {
  this.usesGlobal = undefined;
  return ScopeTransformer.apply(this, arguments);
}
GlobalUsageTransformer.prototype = Object.create(ScopeTransformer.prototype);
GlobalUsageTransformer.prototype.transformIdentifierExpression = function(tree) {
  if (tree.identifierToken.value == this.varName_ && this.usesGlobal !== false)
    this.usesGlobal = true;
  return ScopeTransformer.prototype.transformIdentifierExpression.apply(this, arguments);
};
GlobalUsageTransformer.prototype.transformBindingIdentifier = function(tree) {
  if (tree.identifierToken.value == this.varName_ && this.usesGlobal !== false)
    this.usesGlobal = true;
  return ScopeTransformer.prototype.transformBindingIdentifier.apply(this, arguments);
};
GlobalUsageTransformer.prototype.sameTreeIfNameInLoopInitializer_ = function(tree) {
  try {
    tree = ScopeTransformer.prototype.sameTreeIfNameInLoopInitializer_.call(this, tree);
  }
  catch(e) {}
  return tree;
};

// NB incorrect handling for function Buffer() {}, but we don't have better scope analysis available
// until a shift to Babel :(
GlobalUsageTransformer.prototype.transformFunctionDeclaration = function(tree) {
  if (tree.name && tree.name.identifierToken && tree.name.identifierToken.value == this.varName_)
    this.usesGlobal = false;
  return ScopeTransformer.prototype.transformFunctionDeclaration.apply(this, arguments);
}
GlobalUsageTransformer.prototype.getDoNotRecurse = function(tree) {
  var doNotRecurse;
  try {
    doNotRecurse = ScopeTransformer.prototype.getDoNotRecurse.call(this, tree);
  }
  catch(e) {}
  return doNotRecurse;
};
GlobalUsageTransformer.prototype.transformBlock = function(tree) {
  try {
    tree = ScopeTransformer.prototype.transformBlock.call(this, tree);
  }
  catch(e) {}
  return tree;
};