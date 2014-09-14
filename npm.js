var Promise = require('rsvp').Promise;
var asp = require('rsvp').denodeify;
var request = require('request');
var zlib = require('zlib');
var tar = require('tar');
var fs = require('fs');
var path = require('path');
var glob = require('glob');

var cjsCompiler = require('systemjs-builder/compilers/cjs');

var nodeBuiltins = ['assert', 'buffer', 'console', 'constants', 'domain', 'events', 'fs', 'http', 'https', 'os', 'path', 'process', 'punycode', 'querystring', 
  'string_decoder', 'stream', 'timers', 'tls', 'tty', 'url', 'util', 'vm', 'zlib'];

// note these are not implemented:
// child_process, cluster, crypto, dgram, dns, net, readline, repl, tls

var tmpDir, registryURL, auth;

var NPMLocation = function(options) {
  this.name = options.name;
  // default needed during upgrade time period
  registryURL = options.registry || 'https://registry.npmjs.org';
  tmpDir = options.tmpDir;
  this.remote = options.remote;

  if (options.username && options.password)
    auth = {
      user: options.username,
      pass: options.password
    };
}

var bufferRegEx = /(^\s*|[}{\(\);,\n=:\?\&]\s*)Buffer/;
var processRegEx = /(^\s*|[}{\(\);,\n=:\?\&]\s*)process/;

var metaRegEx = /^(\s*\/\*.*\*\/|\s*\/\/[^\n]*|\s*"[^"]+"\s*;?|\s*'[^']+'\s*;?)+/;
var metaPartRegEx = /\/\*.*\*\/|\/\/[^\n]*|"[^"]+"\s*;?|'[^']+'\s*;?/g;

var cmdCommentRegEx = /^\s*#/;

var lookupCache = {};

NPMLocation.configure = function(config, ui) {
  config.remote = config.remote || 'https://npm.jspm.io';
  return ui.input('npm registry to use', config.registry || 'https://registry.npmjs.org')
  .then(function(registry) {
    config.registry = registry;

    return ui.confirm('Would you like to configure authentication?', false);
  })
  .then(function(auth) {
    if (!auth)
      return;

    return Promise.resolve()
    .then(function() {
      return ui.input('Enter your npm username');
    })
    .then(function(username) {
      config.username = username;
      return ui.input('Enter your npm password', null, true);
    })
    .then(function(password) {
      config.password = password;
    });
  })
  .then(function() {
    return config;
  });
}

NPMLocation.prototype = {
  parse: function(name) {
    var parts = name.split('/');
    return {
      package: parts[0],
      path: parts.splice(1).join('/')
    };
  },

  lookup: function(repo) {
    var self = this;
    return asp(request)(registryURL + '/' + repo, {
      strictSSL: false,
      auth: auth,
      headers: lookupCache[repo] ? {
        'if-none-match': lookupCache[repo].hash
      } : {}
    }).then(function(res) {
      if (res.statusCode == 304)
        return lookupCache[repo].versions;

      if (res.statusCode == 404)
        return { notfound: true };

      if (res.statusCode == 401)
        throw 'Invalid authentication details. Run %jspm endpoint config ' + self.name + '% to reconfigure.';

      if (res.statusCode != 200)
        throw 'Invalid status code ' + res.statusCode;

      var versions = {};
      var packageData;
      
      try {
        packageData = JSON.parse(res.body).versions;
      }
      catch(e) {
        throw 'Unable to parse package.json';
      }

      for (var v in packageData) {
        if (packageData[v].dist && packageData[v].dist.shasum)
          versions[v] = packageData[v].dist.shasum;
      }

      if (res.headers.etag)
        lookupCache[repo] = {
          hash: res.headers.etag,
          versions: versions,
          packageData: packageData
        };

      return { versions: versions };
    });
  },

  getPackageConfig: function(repo, version, hash) {
    var pjson = lookupCache[repo] && lookupCache[repo].packageData[version];
    if (!pjson)
      throw 'Package.json lookup not found';
    if (hash && pjson.dist.shasum != hash) {
      throw 'Package.json lookup hash mismatch';
    }

    pjson.dependencies = pjson.dependencies || {};
    pjson.registry = pjson.registry || this.name;

    // this allows users to opt-out of npm require assumptions
    // but still use the npm registry anyway
    // disabled due to registry meaning confusion
    // alternative opt-out property may be used in future
    //if (pjson.registry == 'npm') {
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
    //}

    return pjson;
  },

  download: function(repo, version, hash, outDir) {
    return new Promise(function(resolve, reject) {
      var versionData = lookupCache[repo] && lookupCache[repo].packageData[version];

      if (!versionData)
        throw 'Package.json lookup not found';

      request({
        uri: versionData.dist.tarball,
        headers: { 'accept': 'application/octet-stream' },
        strictSSL: false
      })
      .on('response', function(npmRes) {

        if (npmRes.statusCode != 200)
          return reject('Bad response code ' + npmRes.statusCode);
        
        if (npmRes.headers['content-length'] > 50000000)
          return reject('Response too large.');

        npmRes.pause();

        var gzip = zlib.createGunzip();

        npmRes
        .pipe(gzip)
        .pipe(tar.Extract({ path: outDir, strip: 1 }))
        .on('error', reject)
        .on('end', resolve);

        npmRes.resume();
      })
      .on('error', reject);
    });
  },

  build: function(pjson, dir) {

    var buildErrors = [];

    return asp(glob)(dir + path.sep + '**' + path.sep + '*.js')
    .then(function(files) {
      return Promise.all(files.map(function(file) {
        var filename = path.relative(dir, file);
        filename = filename.substr(0, filename.length - 3);
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

          // at this point, only alter the source file if we're certain it is CommonJS in Node-style

          // first check if we have format meta
          var meta = source.match(metaRegEx);
          var metadata = {};
          if (meta) {
            var metaParts = meta[0].match(metaPartRegEx);
            for (var i = 0; i < metaParts.length; i++) {
              var len = metaParts[i].length;

              var firstChar = metaParts[i].substr(0, 1);
              if (metaParts[i].substr(len - 1, 1) == ';')
                len--;
            
              if (firstChar != '"' && firstChar != "'")
                continue;

              var metaString = metaParts[i].substr(1, metaParts[i].length - 3);

              var metaName = metaString.substr(0, metaString.indexOf(' '));
              if (metaName) {
                var metaValue = metaString.substr(metaName.length + 1, metaString.length - metaName.length - 1);

                if (metadata[metaName] instanceof Array)
                  metadata[metaName].push(metaValue);
                else
                  metadata[metaName] = metaValue;
              }
            }
          }

          if (pjson.format != 'cjs' && !metadata.format)
            return;

          if (metadata.format && metadata.format != 'cjs')
            return;
          
          if (pjson.shim && pjson.shim[filename])
            return;

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
            buildErrors.push(err);
          });
        });
      }));
    })
    .then(function() {
      return buildErrors;
    });
  }
};

module.exports = NPMLocation;
