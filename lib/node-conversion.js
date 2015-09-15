var Promise = require('rsvp').Promise;
var asp = require('rsvp').denodeify;
var fs = require('graceful-fs');
var path = require('path');
var url = require('url');
var readdirp = require('readdirp');

var nodeCoreModules = {
  'assert': 'npm:assert@1.3.0',
  'buffer': 'npm:buffer@^3.4.3',
  'child_process': '@node/child_process',
  'cluster': '@node/cluster',
  'console': 'npm:console-browserify@^1.1.0',
  'constants': 'npm:constants-browserify@^1.0.0',
  'crypto': 'npm:crypto-browserify@^3.9.14',
  'dgram': '@node/dgram',
  'dns': '@node/dns',
  'domain': 'npm:domain-browser@^1.1.4',
  'events': 'npm:events@^1.0.2',
  'fs': 'nodelibs/fs',
  'http': 'npm:stream-http@^1.5.0',
  'https': 'npm:https-browserify@0.0.1',
  'module': '@node/module',
  'net': 'npm:net-browserify@^0.2.1',
  'os': 'npm:os-browserify@^0.1.2',
  'path': 'npm:path-browserify@^0.0.0',
  'process': 'npm:process@^0.11.2',
  'punycode': 'npm:punycode@^1.3.2',
  'querystring': 'npm:querystring@^0.2.0',
  'readline': '@node/readline',
  'repl': '@node/repl',
  'stream': 'npm:stream-browserify@^2.0.1',
  'string_decoder': 'npm:string_decoder@^0.10.31',
  'sys': 'npm:util@^0.10.3',
  'timers': 'npm:timers-browserify@^1.4.1',
  'tls': 'npm:tls-browserify@^0.1.3',
  'tty': 'npm:tty-browserify@^0.0.0',
  'url': 'npm:url@^0.11.0',
  'util': 'npm:util@^0.10.3',
  'vm': 'npm:vm-browserify@^0.0.4',
  'zlib': 'npm:browserify-zlib@^0.1.4'
};

exports.convertPackage = function(pjson, dir, ui) {
  var packageName = pjson.name;

  // if already configured for SystemJS, then use that
  if (pjson.systemjs)
    return pjson;

  var packageConfig = { dependencies: {} };

  // check every file in this package and return the file structure
  // and all internal require('x') statements that are made
  return new Promise(function(resolve, reject) {
    var fileTree = {};
    readdirp({ root: dir, entryType: 'both' }, function(entry) {
      var listingName = entry.path;
      if (entry.stat.isDirectory())
        listingName += '/';
      fileTree[listingName] = true;
    }, function(err) {
      if (err)
        reject(err);
      else
        resolve(fileTree);
    });
  })
  .then(function(fileTree) {
    // format
    if (pjson.format && pjson.format != 'cjs')
      this.ui.log('warn', 'Package `' + packageName + '` has a format set, which is being ignored by the jspm Node resolution conversion.\n'
          + 'Set %jspmNodeConversion: false% in the packge config for the package to skip this process.');

    // defaultExtension
    if (pjson.defaultExtension && pjson.defaultExtension != 'js')
      this.ui.log('warn', 'Package `' + packageName + '` has a defaultExtension set, which is being ignored by the jspm Node resolution conversion.\n'
          + 'Set %jspmNodeConversion: false% in the packge config for the package to skip this process.');

    // main
    packageConfig.main = nodeResolve(typeof pjson.main == 'string' && pjson.main || 'index.js', '', fileTree);

    // format
    packageConfig.format = 'cjs';

    // meta
    packageConfig.meta = {
      '*.json': {
        loader: 'nodelibs/json'
      }
    };
    for (var m in pjson.meta)
      packageConfig.meta[m] = pjson.meta[m];

    // map
    packageConfig.map = {};
    for (var m in pjson.map)
      packageConfig.map[m] = pjson.map[m];

    // browser main mapping
    var browserMain = nodeResolve(typeof pjson.browser == 'string' && pjson.browser || typeof pjson.browserify == 'string' && pjson.browserify || packageConfig.main, '', fileTree);
    if (browserMain != packageConfig.main && !packageConfig.map[packageConfig.main])
      packageConfig.map['./' + packageConfig.main] = {
        browser: './' + browserMain
      };

    // convert pjson browser -> map config
    if (typeof pjson.browser == 'object')
      for (var b in pjson.browser) {
        // dont replace any existing map config
        if (packageConfig.map[b])
          continue;

        var mapping = pjson.browser[b];

        if (mapping === false)
          mapping = '@empty';
        else if (typeof mapping == 'string')
          mapping = './' + nodeResolve(mapping, '', fileTree);
        else
          continue;

        packageConfig.map[b] = {
          browser: mapping
        };
      }


    var coreDeps = [];

    /*
     * Comprehensive internal resolution differences between SystemJS and Node
     * for internal package requires (that is ignoring package.json, node_modules)
     *
     * 1. Directory requires won't resolve to index.js in the directory
     * 2. Files not ending in js, that are js will add extensions
     * 3. A file by the name file.js.js loaded as file.js will not add extensions
     * 4. A file by the name file.json.js loaded as file.json will not add extensions
     * 5. Browserify mappings will affect folders by the same name (./file.js/...)
     *
     * Currently we cater to (1 - 4) above by parsing all CommonJS requires of all JS files in 
     * the package and where a resolution matches one of these cases, we include meta: true
     * config for files and maps to the index.js for directories.
     *
     * It may turn out to be useful to do this for external requires as well, in which
     * case we can switch this algorithm to a comprehensive correction configuration
     * being constructed against the entire fileTree to handle all resolution differences.
     */
    var resolutionMap = {};
    var metas = {};
    return Promise.all(Object.keys(fileTree).filter(function(file) {
      return file[file.length - 1] != '/';
    }).map(function(fileName) {

      var meta = readMeta(fileName, packageConfig.meta);

      // skip parsing files set to a non-cjs format
      if (meta.format && meta.format != 'cjs')
        return;

      return parseNodeRequires(path.resolve(dir, fileName))
      .catch(function(err) {
        err.stack = 'Error parsing ' + fileName + '\n' + err.stack;
        throw err;
      })
      .then(function(parsed) {
        var requires = parsed.requires, 
            usesProcess = parsed.usesProcess, 
            usesBuffer = parsed.usesBuffer;

        // add process and buffer globals config for files that need it
        if (usesProcess || usesBuffer) {
          var meta = metas[fileName] = typeof metas[fileName] == 'object' ? metas[fileName] : {};
          meta.globals = meta.globals || {};

          if (usesProcess) {
            meta.globals.process = 'process';
            if (coreDeps.indexOf('process') == -1)
              coreDeps.push('process');
          }
          if (usesBuffer) {
            meta.globals.Buffer = 'buffer';
            if (coreDeps.indexOf('buffer') == -1)
              coreDeps.push('buffer');
          }
        }

        requires.forEach(function(req) {
          // package require by own name
          if (req.substr(0, packageName.length) == packageName && req[packageName.length] == '/' || req.length == packageName.length) {
            resolutionMap[packageName] = '.';
            return;
          }
          // if it is a package require, note if we have a new core dep
          if (req[0] != '.') {
            var coreResolution = nodeCoreModules[req];
            // non-browser core module
            if (coreResolution) {
              // non-browser core module
              if (coreResolution.indexOf(':') == -1)
                resolutionMap[req] = coreResolution;
              else if (coreDeps.indexOf(req) == -1)
                coreDeps.push(req);
            }
            return;
          }

          var nodeResolved = nodeResolve(req, fileName, fileTree);

          // if it didn't resolve, ignore it
          if (!nodeResolved)
            return;

          // 1. directory resolution
          if (nodeResolved.substr(nodeResolved.length - 8) == 'index.js' && req.substr(req.length - 8) != 'index.js')
            resolutionMap['./' + nodeResolved.substr(0, nodeResolved.length - 8)] = './' + nodeResolved;
          
          // 2. non js file extension
          else if (nodeResolved.substr(nodeResolved.length - 3, 3) != '.js' && nodeResolved.substr(nodeResolved.length - 5, 5) != '.json')
            metas[nodeResolved] = metas[nodeResolved] || true;
          
          // 3. file.js.js
          else if (nodeResolved.substr(nodeResolved.length - 6, 6) == '.js.js')
            metas[nodeResolved] = metas[nodeResolved] || true;
          
          // 4. file.json.js
          else if (nodeResolved.substr(nodeResolved.length - 8, 8) == '.json.js')
            metas[nodeResolved] = metas[nodeResolved] || true;
        });

      });
    }))
    .then(function() {

      // add core dependencies
      coreDeps.sort().forEach(function(dep) {
        if (!packageConfig.map[dep] && !packageConfig.dependencies[dep] && nodeCoreModules[dep].indexOf(':') != -1)
          packageConfig.dependencies[dep] = nodeCoreModules[dep];
      });

      // merge in require resolution map
      Object.keys(resolutionMap).sort().forEach(function(m) {
        if (!packageConfig.map[m])
          packageConfig.map[m] = resolutionMap[m];
      });
      
      // add metas
      Object.keys(metas).sort().forEach(function(m) {
        if (!packageConfig.meta[m])
          packageConfig.meta[m] = metas[m];
      });

      return packageConfig;
    });
  });
};

var metaRegEx = /^(\s*\/\*[^\*]*(\*(?!\/)[^\*]*)*\*\/|\s*\/\/[^\n]*|\s*"[^"]+"\s*;?|\s*'[^']+'\s*;?)+/;
var metaPartRegEx = /\/\*[^\*]*(\*(?!\/)[^\*]*)*\*\/|\/\/[^\n]*|"[^"]+"\s*;?|'[^']+'\s*;?/g;

var cmdCommentRegEx = /^\s*#/;

function parseNodeRequires(filePath) {
  var output = {
    requires: [],
    usesProcess: false,
    usesBuffer: false
  };

  return asp(fs.readFile)(filePath)
  .catch(function(err) {
    throw new Error('Error reading file ' + filePath + ', ' + err.code);
  })
  .then(function(source) {
    source = source.toString();

    // first check if we have format meta
    var meta = source.match(metaRegEx);
    if (meta) {
      var metaParts = meta[0].match(metaPartRegEx);

      for (var i = 0; i < metaParts.length; i++) {
        var curPart = metaParts[i];
        var len = curPart.length;

        var firstChar = curPart.substr(0, 1);
        if (curPart.substr(len - 1, 1) == ';')
          len--;

        if (firstChar != '"' && firstChar != "'")
          continue;

        var metaString = curPart.substr(1, curPart.length - 3);

        // skip any processing if this has format-level meta
        if (metaString == 'format global' || metaString == 'format amd' || metaString == 'format register' || metaString == 'bundle' || metaString == 'format esm')
          return output;
      }
    }

    if (source.match(cmdCommentRegEx))
      source = '//' + source;

    // attempt to create a syntax tree and parse out require statements, Buffer and process usage
    return require('./deps-transformer')(source);
  });
}

// pulled out of SystemJS internals...
function readMeta(pkgPath, pkgMeta) {
  var meta = {};

  // apply wildcard metas
  var bestDepth = 0;
  var wildcardIndex;
  for (var module in pkgMeta) {
    wildcardIndex = module.indexOf('*');
    if (wildcardIndex === -1)
      continue;
    if (module.substr(0, wildcardIndex) === pkgPath.substr(0, wildcardIndex)
        && module.substr(wildcardIndex + 1) === pkgPath.substr(pkgPath.length - module.length + wildcardIndex + 1)) {
      var depth = module.split('/').length;
      if (depth > bestDepth)
        bestDepth = depth;
      extendMeta(meta, pkgMeta[module], bestDepth != depth);
    }
  }

  // apply exact meta
  if (meta[pkgPath])
    extendMeta(load.metadata, meta[pkgPath]);

  return meta;
}
function extendMeta(a, b, prepend) {
  for (var p in b) {
    var val = b[p];
    if (!(p in a))
      a[p] = val;
    else if (val instanceof Array && a[p] instanceof Array)
      a[p] = [].concat(prepend ? val : a[p]).concat(prepend ? a[p] : val);
    else if (typeof val == 'object' && typeof a[p] == 'object')
      a[p] = extend(extend({}, a[p]), val, prepend);
    else if (!prepend)
      a[p] = val;
  }
}
function extend(a, b, prepend) {
  for (var p in b) {
    if (!prepend || !(p in a))
      a[p] = b[p];
  }
  return a;
}

/* 
 * Given a file tree stat, work out the resolution for a package
 * name is a path within the package, parent is also a path within the package
 * fileTree is keyed by path, with true as the value. Folders are indicated by trailling /
 * All paths are assumed '/' separated for this implementation
 */
function nodeResolve(name, parent, fileTree) {
  // leave absolute paths undisturbed
  if (name[0] == '/')
    return;

  // relative paths are resolved relatively and statted
  if (name.substr(0, 2) == './' || name.substr(0, 3) == '../' && parent.indexOf('/') != -1) {
    name = url.resolve('/' + parent, name).substr(1);

    if (fileTree[name])
      return name;

    if (fileTree[name + '.js'])
      return name + '.js';

    if (fileTree[name + 'json'])
      return name + '.json';

    // no file match -> try loading as a folder
    var folderName = name + (name[name.length - 1] == '/' ? '' : '/');

    if (fileTree[folderName])
      return folderName + 'index.js';
  }

  // plain name -> package resolution
  return name;
}