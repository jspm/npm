var Promise = require('rsvp').Promise;
var asp = require('rsvp').denodeify;
var request = require('request');
var zlib = require('zlib');
var tar = require('tar');
var fs = require('fs');
var rmdir = require('rmdir');
var path = require('path');
var glob = require('glob');

var cjsCompiler = require('systemjs-builder/compilers/cjs');

var tmpDir;

var nodeBuiltins = ['assert', 'buffer', 'console', 'constants', 'domain', 'events', 'fs', 'http', 'https', 'os', 'path', 'process', 'punycode', 'querystring', 
  'string_decoder', 'stream', 'timers', 'tls', 'tty', 'url', 'util', 'vm', 'zlib'];

// note these are not implemented:
// child_process, cluster, crypto, dgram, dns, net, readline, repl, tls


var NPMLocation = function(options) {
  this.baseDir = options.baseDir;
  tmpDir = options.tmpDir;
  this.log = options.log === false ? false : true;
}

var bufferRegEx = /(^\s*|[}{\(\);,\n=:\?\&]\s*)Buffer/;
var processRegEx = /(^\s*|[}{\(\);,\n=:\?\&]\s*)process/;

var cmdCommentRegEx = /^\s*#/;

function processNpmFiles(dir, pjson, log) {
  return asp(glob)(dir + path.sep + '**' + path.sep + '*.js')
  .then(function(files) {
    return Promise.all(files.map(function(file) {
      var curSource;

      return Promise.resolve()

      // create an index.js forwarding module if necessary
      .then(function() {
        if (path.basename(file) == 'index.js' && path.dirname(file) != dir) {
          var dirname = path.dirname(file);
          return asp(fs.writeFile)(dirname + '.js', 'module.exports = "./' + path.basename(dirname) + '/index.js";');
        }        
      })

      .then(function() {
        return asp(fs.readFile)(file);
      })
      .then(function(source) {
        curSource = source;
        var changed = false;
        source = source.toString();

        if (source.match(cmdCommentRegEx))
          source = '//' + source;

        // Note an alternative here would be to use https://github.com/substack/insert-module-globals
        var usesBuffer = source.match(bufferRegEx), usesProcess = source.match(processRegEx);

        if (usesBuffer || usesProcess) {
          changed = true;
          source = "(function(" + (usesBuffer && 'Buffer' || '') + (usesBuffer && usesProcess && ", " || '') + (usesProcess && 'process' || '') + ") {" + source
              + "\n})(" + (usesBuffer && "require('buffer').Buffer" || '') + (usesBuffer && usesProcess && ", " || '') + (usesProcess && "require('process')" || '') + ");";
        }

        // remap require statements, with mappings:
        // require('file.json') -> require('file.json!')
        // require('dir/') -> require('dir/index')
        // require('file.js') -> require('file')
        // finally we map builtins to the adjusted module
        return cjsCompiler.remap(source, function(dep) {
          if (dep.substr(dep.length - 5, 5) == '.json') {
            pjson.dependencies['json'] = '*';
            changed = true;
            return dep + '!';
          }
          if (dep.substr(dep.length - 1, 1) == '/') {
            changed = true;
            dep = dep + 'index';
          }
          else if (dep.substr(dep.length - 3, 3) == '.js') {
            changed = true;
            dep = dep.substr(0, dep.length - 3);
          }

          var firstPart = dep.substr(0, dep.indexOf('/')) || dep;
          var builtinIndex = nodeBuiltins.indexOf(firstPart);
          if (builtinIndex != -1) {
            changed = true;
            var name = nodeBuiltins[builtinIndex];
            dep = 'github:jspm/nodelibs@0.0.3/' + name + dep.substr(firstPart.length);
          }
          return dep;
        }, file)
        .then(function(output) {
          if (!changed)
            return;
          return asp(fs.writeFile)(file, output.source);
        }, function(err) {
          if (log)
            console.log(err);
        });
      });

    }));
  });
}



var versionCache = {};

NPMLocation.prototype = {
  degree: 1,
  getVersions: function(repo, callback, errback) {
    request('https://registry.npmjs.org/' + repo, {
      strictSSL: false,
      headers: versionCache[repo] ? {
        'if-none-match': versionCache[repo].hash
      } : {}
    }, function(err, res, body) {
      if (err)
        return errback(err);

      if (res.statusCode == 304)
        return callback(versionCache[repo].versions);

      if (res.statusCode != 200)
        return callback();

      var versions = {};
      var versionData;
      
      try {
        versionData = JSON.parse(body).versions;
      }
      catch(e) {
        return errback(e);
      }

      if (!versionData)
        return callback();

      for (var v in versionData) {
        if (versionData[v].dist && versionData[v].dist.shasum)
          versions[v] = versionData[v].dist.shasum;
      }

      if (res.headers.etag)
        versionCache[repo] = {
          hash: res.headers.etag,
          versions: versions,
          versionData: versionData
        };

      callback(versions);
    });
  },
  download: function(repo, version, hash, outDir, callback, errback) {

    if (this.log)
      console.log(new Date() + ': Requesting package npm:' + repo);

    var versionData = versionCache[repo] && versionCache[repo].versionData;
    var tarball = 'https://registry.npmjs.org/' + repo + '/-/' + repo + '-' + version + '.tgz';
    if (versionData && versionData[version])
      tarball = versionData[version].dist.tarball;

    request({
      uri: tarball,
      headers: { 'accept': 'application/octet-stream' },
      strictSSL: false
    })
    .on('response', function(npmRes) {

      if (npmRes.statusCode != 200)
        return errback('Bad response code ' + npmRes.statusCode);
      
      if (npmRes.headers['content-length'] > 10000000)
        return errback('Response too large.');

      npmRes.pause();

      var gzip = zlib.createGunzip();

      npmRes
      .pipe(gzip)
      .pipe(tar.Extract({ path: outDir, strip: 1 }))
      .on('error', errback)
      .on('end', function() {

        // read package.json and get dependencies and versions
        fs.readFile(outDir + path.sep + 'package.json', function(err, data) {
          if (err && err.code != 'ENOENT')
            return errback();

          var pjson;
          try {
            pjson = JSON.parse(data + '');
          }
          catch (e) {
            pjson = {};
          }

          pjson.dependencies = pjson.dependencies || {};
          pjson.registry = pjson.registry || 'npm';

          // this allows users to opt-out of npm require assumptions
          // but still use the npm registry anyway
          if (pjson.registry == 'npm') {
            // NB future versions could use pjson.engines.node to ensure correct builtin node version compatibility
            pjson.dependencies['nodelibs'] = 'jspm/nodelibs#0.0.3';

            // peer dependencies are just dependencies in jspm
            if (pjson.peerDependencies) {
              for (var d in pjson.peerDependencies)
                pjson.dependencies[d] = pjson.peerDependencies[d];
            }

            pjson.format = pjson.format || 'cjs';

            pjson.buildConfig = pjson.buildConfig || {};
            if (!('minify' in pjson.buildConfig))
              pjson.buildConfig.minify = true;

            // ignore directory handling for NodeJS, as npm doesn't do it
            delete pjson.directories;
            // ignore files and ignore as npm already does this for us
            delete pjson.files;
            delete pjson.ignore;

            processNpmFiles(outDir, pjson, this.log).then(function() {
              callback(pjson);
            }, errback);
          }
          else
            callback(pjson);
        });

      });

      npmRes.resume();
    })
    .on('error', errback);
  }
};

module.exports = NPMLocation;
