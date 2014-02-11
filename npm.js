var request = require('request');
var zlib = require('zlib');
var tar = require('tar');
var fs = require('fs');
var rmdir = require('rmdir');
var path = require('path');
var glob = require('glob');

var tmpDir;

var nodeBuiltins = ['assert', 'buffer', 'console', 'constants', 'domain', 'events', 'http', 'https', 'os', 'path', 'punycode', 'querystring', 
  'string_decorder', 'stream', 'timers', 'tls', 'tty', 'url', 'util', 'vm', 'zlib']

// note these are not implemented:
// child_process, cluster, crypto, dgram, dns, net, fs, readline, repl, tls


var NPMLocation = function(options) {
  this.baseDir = options.baseDir;
  tmpDir = options.tmpDir;
  this.log = options.log === false ? false : true;
}

var version304Cache = {};

NPMLocation.prototype = {
  degree: 1,
  getVersions: function(repo, callback, errback) {
    request('https://registry.npmjs.org/' + repo, {
      strictSSL: false,
      headers: version304Cache[repo] ? {
        'if-none-match': version304Cache[repo]
      } : {}
    }, function(err, res, body) {
      if (err)
        return errback(err);

      if (res.statusCode == 304)
        return callback(version304Cache[repo]);

      if (res.statusCode != 200)
        return callback();

      var versions;
      
      try {
        versions = versions || JSON.parse(body).versions;
      }
      catch(e) {
        return errback(e);
      }

      if (!versions)
        return callback();

      for (var v in versions) {
        if (versions[v].dist && versions[v].dist.shasum)
          versions[v] = versions[v].dist.shasum;
        else
          delete versions[v];
      }

      if (res.headers.etag)
        version304Cache[res.headers.etag] = versions;

      callback(versions);
    });
  },
  download: function(repo, version, hash, outDir, callback, errback) {

    if (this.log)
      console.log(new Date() + ': Requesting package npm:' + repo);

    request({
      uri: 'https://registry.npmjs.org/' + repo + '/-/' + repo + '-' + version + '.tgz', 
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

          if (pjson.registry == 'npm') {
            // NB future versions could use pjson.engines.node to ensure correct builtin node version compatibility
            pjson.dependencies['nodelibs'] = 'jspm/nodelibs#0.0.2';
            pjson.map = pjson.map || {};
            for (var i = 0; i < nodeBuiltins.length; i++)
              pjson.map[nodeBuiltins[i]] = 'github:jspm/nodelibs/' + nodeBuiltins[i];

            pjson.map['process'] = '@@nodeProcess';
          }

          pjson.buildConfig = pjson.buildConfig || {};
          if (!('minify' in pjson.buildConfig))
            pjson.buildConfig.minify = true;

          callback(pjson);

        });

      });

      npmRes.resume();

    })
    .on('error', errback);

  }
};

module.exports = NPMLocation;
