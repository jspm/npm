var traceur = require('traceur');

var ParseTreeTransformer = traceur.get('codegeneration/ParseTreeTransformer.js').ParseTreeTransformer;
var ScopeTransformer = traceur.get('codegeneration/ScopeTransformer.js').ScopeTransformer;


var Script = traceur.get('syntax/trees/ParseTrees.js').Script;
var parseStatements = traceur.get('codegeneration/PlaceholderParser.js').parseStatements;
var STRING = traceur.get('syntax/TokenType.js').STRING;
var LiteralExpression = traceur.get('syntax/trees/ParseTrees.js').LiteralExpression;
var LiteralToken = traceur.get('syntax/LiteralToken.js').LiteralToken;


module.exports = function(source) {
  var output = { requires: [], usesProcess: false, usesBuffer: false };

  var compiler = new traceur.Compiler({ script: true });
  try {
    var tree = compiler.parse(source);
  }
  catch(e) {
    return output;
  }

  var transformer;

  // sets output.requires
  transformer = new CJSDepsTransformer();
  transformer.transformAny(tree);
  output.requires = transformer.requires;

  // sets output.usesBuffer
  transformer = new GlobalUsageTransformer('Buffer');
  transformer.transformAny(tree);
  output.usesBuffer = transformer.usesGlobal;
  
  return output;
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
  if (args.length && args[0].type == 'LITERAL_EXPRESSION' && args.length == 1)
    this.requires.push(args[0].literalToken.processedValue);

  return ParseTreeTransformer.prototype.transformCallExpression.call(this, tree);
};

function GlobalUsageTransformer(varName) {
  this.usesGlobal = false;
  return ScopeTransformer.apply(this, arguments);
}
GlobalUsageTransformer.prototype = Object.create(ScopeTransformer.prototype);
GlobalUsageTransformer.prototype.transformIdentifierExpression = function(tree) {
  if (tree.identifierToken.value == this.varName_)
    this.usesGlobal = true;
  return ScopeTransformer.prototype.transformIdentifierExpression.apply(this, arguments);
};
GlobalUsageTransformer.prototype.sameTreeIfNameInLoopInitializer_ = function(tree) {
  try {
    tree = ScopeTransformer.prototype.sameTreeIfNameInLoopInitializer_.call(this, tree);
  }
  catch(e) {}
  return tree;
};
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