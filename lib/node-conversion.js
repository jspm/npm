var Promise = require('bluebird');
var asp = require('bluebird').promisify;
var fs = require('graceful-fs');
var path = require('path');
var url = require('url');
var readdirp = require('readdirp');

// comments below are core overrides awaiting approval
var nodeCoreModules = {
  'assert': 'npm:assert@^1.3.0', // https://github.com/defunctzombie/commonjs-assert/pull/11
  'buffer': 'npm:buffer@^3.5.3',
  'child_process': 'nodelibs/child_process',
  'cluster': 'nodelibs/cluster',
  'console': 'npm:console-browserify@^1.1.0', // https://github.com/Raynos/console-browserify/pull/8
  'constants': 'npm:constants-browserify@^1.0.0', // https://github.com/juliangruber/constants-browserify/pull/3
  'crypto': 'npm:crypto-browserify@^3.11.0', // https://github.com/crypto-browserify/crypto-browserify/pull/144
  'dgram': 'nodelibs/dgram',
  'dns': 'nodelibs/dns',
  'domain': 'npm:domain-browser@^1.1.4', // https://github.com/bevry/domain-browser/pull/7
  'events': 'npm:events@^1.1.0', // https://github.com/Gozala/events/pull/25
  'fs': 'nodelibs/fs',
  'http': 'npm:stream-http@^2.0.2', // https://github.com/jhiesey/stream-http/pull/31
  'https': 'npm:https-browserify@^0.0.1', // https://github.com/substack/https-browserify/pull/4
  'module': 'nodelibs/module',
  'net': 'nodelibs/net',
  'os': 'npm:os-browserify@^0.2.0',
  'path': 'npm:path-browserify@^0.0.0', // https://github.com/substack/path-browserify/pull/7
  'process': 'nodelibs/process',
  'punycode': 'npm:punycode@^1.3.2', // pending 1.3.3 release
  'querystring': 'npm:querystring@^0.2.0', // https://github.com/Gozala/querystring/pull/13
  'readline': 'nodelibs/readline',
  'repl': 'nodelibs/repl',
  'stream': 'npm:stream-browserify@^2.0.1', // https://github.com/substack/stream-browserify/pull/14
  'string_decoder': 'npm:string_decoder@^0.10.31', // https://github.com/substack/string_decoder/pull/5
  'sys': 'npm:util@^0.10.3', // https://github.com/defunctzombie/node-util/pull/7
  'timers': 'npm:timers-browserify@^1.4.1', // https://github.com/jryans/timers-browserify/pull/18
  'tls': 'nodelibs/tls',
  'tty': 'npm:tty-browserify@^0.0.0', // https://github.com/substack/tty-browserify/pull/1
  'url': 'npm:url@^0.11.0', // https://github.com/defunctzombie/node-url/pull/23
  'util': 'npm:util@^0.10.3', // https://github.com/defunctzombie/node-util/pull/8
  'vm': 'npm:vm-browserify@^0.0.4', // https://github.com/substack/vm-browserify/pull/15
  'zlib': 'npm:browserify-zlib@^0.1.4' // https://github.com/devongovett/browserify-zlib/pull/10
};

// NB core modules that do not take the PRs above, can be given a wrapper in nodelibs
// and added as a dependency without being a dependency of nodelibs

exports.convertPackage = function(pjson, dir, ui) {
  var packageName = pjson.name;

  var systemConfig = pjson.systemjs || pjson;

  var packageConfig = { dependencies: {}, peerDependencies: {} };

  // check every file in this package and return the file structure
  // and all internal require('x') statements that are made
  return new Promise(function(resolve, reject) {
    var fileTree = {};
    readdirp({
      root: dir,
      entryType: 'both',
      directoryFilter: ['!node_modules', '!test', '!.git']
    }, function(entry) {
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
    /* if (systemConfig.format && systemConfig.format != 'cjs')
      ui.log('warn', 'Package `' + packageName + '` has a format set, which is being ignored by the jspm Node resolution conversion.\n'
          + 'Set %jspmNodeConversion: false% in the package config for the package to skip this process.'); */

    // defaultExtension
    /* if (systemConfig.defaultExtension && systemConfig.defaultExtension != 'js')
      ui.log('warn', 'Package `' + packageName + '` has a defaultExtension set, which is being ignored by the jspm Node resolution conversion.\n'
          + 'Set %jspmNodeConversion: false% in the package config for the package to skip this process.'); */

    // main
    packageConfig.main = nodeResolve(typeof systemConfig.main == 'string' && systemConfig.main || 'index.js', '', fileTree);

    // format
    var format = packageConfig.format = systemConfig.format || 'cjs';

    // meta
    // existing values override
    var meta;
    if (systemConfig.meta)
      packageConfig.meta = systemConfig.meta;
    else
      meta = {
        '*': {
          globals: {
            process: 'nodelibs/process'
          }
        },
        '*.json': {
          loader: 'nodelibs/json'
        }
      };

    // map
    // existing value override
    var map;
    if (systemConfig.map)
      packageConfig.map = systemConfig.map;
    else
      map = {};
    
    // add package.json browser maps
    if (map) {  
      var browserMain = nodeResolve(typeof pjson.browser == 'string' && pjson.browser || typeof pjson.browserify == 'string' && pjson.browserify || packageConfig.main, '', fileTree);
      if (browserMain && browserMain != packageConfig.main && !map['./' + packageConfig.main])
        map['./' + packageConfig.main] = {
          browser: './' + browserMain
        };

      if (typeof pjson.browser == 'object')
        for (var b in pjson.browser) {
          // dont replace any existing map config
          if (map[b])
            continue;

          var mapping = pjson.browser[b];
          var mapResolve;

          if (mapping === false)
            mapResolve = '@empty';
          else if (typeof mapping == 'string')
            mapResolve = nodeResolve(mapping, '', fileTree, true);
          
          // (NB skip external conditional case pending https://github.com/systemjs/systemjs/issues/937)
          if (mapResolve && !(b.substr(0, 2) != './' && mapResolve.substr(0, 2) != './'))
            map[b] = {
              browser: mapResolve
            };
        }
    }

    var coreDeps = [];

    /*
     * Comprehensive internal resolution differences between SystemJS and Node
     * for internal package requires (that is ignoring package.json, node_modules)
     *
     * 1. Directory requires won't resolve to index.js in the directory
     * 2. Files that resolve to .json, not already ending in .json, are mapped
     * 3. Files that don't end in .js, that are actual files, will not add extensions
     * 4. A file by the name file.js.js loaded as file.js will not add extensions
     * 5. A file by the name file.json.js loaded as file.json will not add extensions
     * 6. Browserify mappings will affect folders by the same name (./file.js/...)
     *
     * Currently we cater to (1) by creating a directory map for any index.js file present
     * in a directory where the directory.js file does not exist.
     * We then cater to (2 - 4) above by parsing all CommonJS requires of all JS files in 
     * the package and where a resolution matches one of these cases, we include meta: true
     * config for these files.
     *
     * We only cater to these assumptions for CommonJS modules
     *
     * It may turn out to be useful to do (2 - 4) for external requires as well, in which
     * case we can switch this algorithm to a comprehensive correction configuration
     * being constructed against the entire fileTree to handle all resolution differences.
     *
     * Even better may turn out to have a post-install hook phase, which can actually investigate
     * the contents of dependencies to do a similar analysis above to avoid config bloat
     */

     // track paths that have all common meta
     // to simplify with wildcards
    var parsedCommonMeta = {};

    return Promise.all(Object.keys(fileTree).filter(function(file) {
      return file[file.length - 1] != '/';
    }).map(function(fileName) {

      var existingMeta = packageConfig.meta && readMeta(fileName, packageConfig.meta) || {};
      var existingFormat = existingMeta.format || systemConfig.format;

      return parseModule(path.resolve(dir, fileName), existingFormat)
      .then(function(parsed) {
        var requires = parsed.requires,
            usesBuffer = parsed.usesBuffer,
            fileFormat = parsed.format;

        if (meta) {
          var curMeta = typeof meta[fileName] == 'object' && meta[fileName];

          if (fileFormat != format) {
            curMeta = curMeta || {};
            curMeta.format = fileFormat;
          }

          // global modules do not need the CJS process shim
          if (fileFormat == 'global') {
            curMeta = curMeta || {};
            curMeta.globals = curMeta.globals || {};
          }
          // add buffer global for CJS files that need it
          if (usesBuffer && fileFormat == 'cjs') {
            curMeta = curMeta || {};
            curMeta.globals = curMeta.globals || {};
            curMeta.globals.Buffer = 'nodelibs/buffer';
            if (coreDeps.indexOf('buffer') == -1)
              coreDeps.push('buffer');
          }

          // note common meta for wildcard simplification
          var pathParts = fileName.split('/');
          for (var i = 1; i < pathParts.length; i++) {
            var curCommonPath = pathParts.slice(0, i).join('/');
            var curCommonParsed = parsedCommonMeta[curCommonPath] = parsedCommonMeta[curCommonPath] || extend({}, curMeta) || {};
            if (curCommonParsed.format && curCommonParsed.format != fileFormat)
              curCommonParsed.format = undefined;
            if (curCommonParsed.globals && JSON.stringify(curCommonParsed.globals) != JSON.stringify(curMeta.globals))
              curCommonParsed.globals = undefined;
          }
          
          if (curMeta)
            meta[fileName] = curMeta;
        }

        // 1. directory resolution
        if (map && fileFormat == 'cjs' && fileName.substr(fileName.length - 9, 9) == '/index.js' && !fileTree[fileName.substr(0, fileName.length - 9) + '.js'])
          map['./' + fileName.substr(0, fileName.length - 9) + '.js'] = './' + fileName;

        requires.forEach(function(req) {
          // package require by own name
          if (req.substr(0, packageName.length) == packageName && req[packageName.length] == '/' || req.length == packageName.length) {
            if (map)
              map[packageName] = '.';
            return;
          }

          // if it is a package require, note if we have a new core dep
          if (req[0] != '.') {
            var coreResolution = nodeCoreModules[req];
            // non-browser core module
            if (coreResolution) {
              // non-browser core module
              if (coreResolution.indexOf(':') == -1) {
                if (map)
                  map[req] = coreResolution;
              }
              else if (coreDeps.indexOf(req) == -1) {
                coreDeps.push(req);
              }
            }
            return;
          }

          // if it is not CommonJS, we don't provide any of the other Node resolution assumptions apart
          // from core module resolution
          if (fileFormat != 'cjs')
            return;

          var nodeResolved = nodeResolve(req, fileName, fileTree);

          // if it didn't resolve, ignore it
          if (!nodeResolved)
            return;

          // 2. auto json extension adding
          if (nodeResolved.substr(nodeResolved.length - 5, 5) == '.json' && req.substr(req.length - 5, 5) != '.json') {
            if (map)
              map['./' + nodeResolved.substr(0, nodeResolved.length - 5)] = './' + nodeResolved;
          }
          else if (meta) {
            // 3. non js file extension
            if (nodeResolved.substr(nodeResolved.length - 3, 3) != '.js')
              meta[nodeResolved] = meta[nodeResolved] || true;
          
            // 4. file.js.js
            else if (nodeResolved.substr(nodeResolved.length - 6, 6) == '.js.js')
              meta[nodeResolved] = meta[nodeResolved] || true;
            
            // 5. file.json.js
            else if (nodeResolved.substr(nodeResolved.length - 8, 8) == '.json.js')
              meta[nodeResolved] = meta[nodeResolved] || true;
          }
        });

      });
    }))
    .then(function() {

      // collapse common meta
      Object.keys(parsedCommonMeta).reverse().forEach(function(commonPath) {
        var curMeta = parsedCommonMeta[commonPath];
        if (!curMeta.format && !curMeta.globals)
          return;
        
        Object.keys(meta).forEach(function(path) {
          if (path.substr(0, commonPath.length) == commonPath && path[commonPath.length] == '/') {
            if (curMeta.format && meta[path].format == curMeta.format)
              delete meta[path].format;
            if (curMeta.globals && JSON.stringify(meta[path].globals) == JSON.stringify(curMeta.globals))
              delete meta[path].globals;
          }
        });
        meta[commonPath + '/*'] = curMeta;
      });

      // add core dependencies
      packageConfig.peerDependencies = packageConfig.peerDependencies || {};
      coreDeps.sort().forEach(function(dep) {
        if ((!packageConfig.map || !packageConfig.map[dep]) && !packageConfig.peerDependencies[dep] && 
            !packageConfig.dependencies[dep] && nodeCoreModules[dep].indexOf(':') != -1)
          packageConfig.peerDependencies[dep] = nodeCoreModules[dep];
      });

      // add map alphabetically
      if (map && hasProperties(map)) {
        packageConfig.map = {};
        Object.keys(map).sort().forEach(function(m) {
          packageConfig.map[m] = map[m];
        });
      }
      
      // add meta alphabetically
      if (meta && hasProperties(meta)) {
        packageConfig.meta = {};
        Object.keys(meta).sort().forEach(function(m) {
          // only set metas that aren't empty
          if (meta[m] === true || hasProperties(meta[m]))
            packageConfig.meta[m] = meta[m];
        });
      }

      return packageConfig;
    });
  });
};

var metaRegEx = /^(\s*\/\*[^\*]*(\*(?!\/)[^\*]*)*\*\/|\s*\/\/[^\n]*|\s*"[^"]+"\s*;?|\s*'[^']+'\s*;?)+/;
var metaPartRegEx = /\/\*[^\*]*(\*(?!\/)[^\*]*)*\*\/|\/\/[^\n]*|"[^"]+"\s*;?|'[^']+'\s*;?/g;

var cmdCommentRegEx = /^\s*#/;

function parseModule(filePath, format) {
  return asp(fs.readFile)(filePath)
  .then(function(source) {
    source = source.toString();

    // empty files will not work with xhr loading -> ensure at least whitespace is present
    if (!source) {
      return asp(fs.writeFile)(filePath, ' ')
      .then(function() {
        return {
          requires: [],
          usesBuffer: false,
          format: 'cjs'
        };
      });
    }

    // first check if we have format meta
    // package format and package meta format take preference though
    if (!format) {
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

          if (metaString.substr(0, 7) == 'format ')
            format = metaString.substr(7);
          else if (metaString == 'bundle')
            format = 'register';
        }
      }
    }

    if (source.match(cmdCommentRegEx))
      source = '//' + source;

    // attempt to create a syntax tree and parse out require statements, Buffer and process usage
    return require('./node-transformer')(source, format);
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

function hasProperties(obj) {
  for (var p in obj)
    return true;
  return false;
}

/* 
 * Given a file tree stat, work out the resolution for a package
 * name is a path within the package, parent is also a path within the package
 * fileTree is keyed by path, with true as the value. Folders are indicated by trailling /
 * All paths are assumed '/' separated for this implementation
 */
function nodeResolve(name, parent, fileTree, dotRel) {
  var dotPrefix = dotRel ? './' : '';

  // leave absolute paths undisturbed
  if (name[0] == '/')
    return;

  // relative paths are resolved relatively and statted
  if (name.substr(0, 2) == './' || name.substr(0, 3) == '../' && parent.indexOf('/') != -1) {
    name = url.resolve('/' + parent, name).substr(1);

    if (fileTree[name])
      return dotPrefix + name;

    if (fileTree[name + '.js'])
      return dotPrefix + name + '.js';

    if (fileTree[name + '.json'])
      return dotPrefix + name + '.json';

    // no file match -> try loading as a folder
    var folderName = name + (name[name.length - 1] == '/' ? '' : '/');

    if (fileTree[folderName])
      return dotPrefix + folderName + 'index.js';

    // unable to resolve -> ignore
    return;
  }

  // plain name -> package resolution
  return name;
}