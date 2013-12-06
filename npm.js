var request = require('request');
var zlib = require('zlib');
var tar = require('tar');
var fs = require('fs');
var rmdir = require('rmdir');
var path = require('path');
var glob = require('glob');

var exactVersionRegEx = /^(\d+)(\.\d+)(\.\d+)?$/;

var tmpDir;

var nodeBuiltins = ['assert', 'child_process', 'dgram', 'events', 'fs', 'https', 'net', 'path', 'process', 'querystring', 
'stream', 'string_decoder', 'sys', 'timers', 'tls', 'tty', 'url', 'util', 'http'];

var NPMLocation = function(options) {
  this.baseDir = options.baseDir;
  tmpDir = options.tmpDir;
  this.log = options.log === false ? false : true;
}

var downloadBuiltin = function(name, version, outDir, callback, errback) {
  // download fs.js as index.js in builtin dir
  request('https://github.jspm.io/jspm/node-browser-builtins@master/builtin/' + name + '.js', {
    strictSSL: false
  }, function(err, res, body) {
    if (err)
      return errback(err);

    fs.writeFile(outDir + path.sep + 'index.js', body, function(err) {
      if (err)
        return errback(err);
        
      lockDependencies(outDir, callback, errback);
    });
  });
}

var version304Cache = {};

var prepareDir = function(dir, callback, errback) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir);
    return callback();
  }

  rmdir(dir, function(err) {
    if (err)
      return errback(err);
    fs.mkdirSync(dir);
    callback();
  });
}

var moveFromTmpDir = function(tmpDir, outDir, callback, errback) {
  fs.readdir(tmpDir, function(err, files) {
    if (err)
      return errback(err);

    var fileCnt = files.length;
    
    if (!fileCnt)
      return errback();

    var renamedFiles = 0;
    for (var i = 0; i < files.length; i++) {
      fs.rename(tmpDir + '/' + files[i], path.resolve(outDir, files[i]), function(err) {
        if (err)
          return errback(err);
        renamedFiles++;
        if (renamedFiles == fileCnt)
          callback();
      });
    }
  });
}

var lockDependencies = function(dir, callback, errback) {
  // read package.json and get dependencies and versions
  fs.readFile(dir + path.sep + 'package.json', function(err, data) {
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

    var replaceMap = {};
    for (var d in pjson.dependencies) {
      var v = pjson.dependencies[d];
      if (v.substr(0, 1) == '~')
        replaceMap['npm:' + d] = 'npm:' + d + '@' + v.substr(1).split('.').splice(0, 2).join('.');
      else if (v.match(exactVersionRegEx))
        replaceMap['npm:' + d] = 'npm:' + d + '@' + v;
      else
        replaceMap['npm:' + d] = 'npm:' + d;
    }
    

    pjson.map = replaceMap;

    if (pjson.main) {
      if (pjson.main.substr(0, 2) == './')
        pjson.main = pjson.main.substr(2);
      if (pjson.main.substr(pjson.main.length - 3, 3) == '.js')
        pjson.main = pjson.main.substr(0, pjson.main.length - 3);
      if (pjson.main == 'index')
        delete pjson.main;
    }

    pjson.buildConfig = pjson.buildConfig || {};
    pjson.buildConfig.uglify = pjson.buildConfig.uglify === undefined ? true : pjson.buildConfig.uglify;

    // glob all the js files and make jspm-compatible
    glob(dir + '/**/*.js', function(err, files) {
      if (err)
        return errback(err);

      if (!files.length)
        return callback(pjson);

      var doneCnt = 0;
      for (var i = 0; i < files.length; i++)
        convertRequires(files[i], function() {
          doneCnt++;
          if (doneCnt == files.length)
            callback(pjson);
        }, errback);
    });
  });
}

var cjsRequireRegEx = /require\s*\(\s*("([^"]+)"|'([^']+)')\s*\)/g;
var convertRequires = function(file, callback, errback) {
  // replace require('some-module/here') with require('some-module@1.1/here')
  var changed = false;
  fs.readFile(file, function(err, data) {
    data = data + '';
    
    data = data.replace(cjsRequireRegEx, function(reqName, str, singleString, doubleString) {
      var name = singleString || doubleString;
      if (name.substr(name.length - 3, 3) == '.js') {
        changed = true;
        return reqName.replace(name, name.substr(0, name.length - 3));
      }
      else if (name.substr(0, 1) != '.') {
        changed = true;
        return reqName.replace(name, 'npm:' + name);
      }
      else
        return reqName;
    });

    if (!changed)
      return callback();

    fs.writeFile(file, data, function(err) {
      if (err)
        return errback(err);
      callback();
    });
  });
}


NPMLocation.prototype = {
  degree: 1,
  getVersions: function(repo, callback, errback) {
    
    if (nodeBuiltins.indexOf(repo) != -1)
      return callback({ '0.0.2': 'IUHFBFHWMD' });

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

    prepareDir(outDir, function() {

      if (nodeBuiltins.indexOf(repo) != -1)
        return downloadBuiltin(repo, version, outDir, callback, errback);

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

        var tmpPath = tmpDir + path.sep + repo;

        prepareDir(tmpPath, function() {

          npmRes
          .pipe(gzip)
          .pipe(tar.Extract({ path: tmpPath }))
          .on('error', errback)
          .on('end', function() {

            // list the dir to get the package folder (older NPM had a varied name)
            fs.readdir(path.resolve(tmpPath), function(err, files) {

              if (err || !files || !files.length)
                return errback();

              moveFromTmpDir(path.resolve(tmpPath, files[0]), outDir, function() {

                lockDependencies(outDir, callback, errback);

              }, errback);

            });

          });

          npmRes.resume();

        }, errback);

      })
      .on('error', errback);

    });

  }
};

module.exports = NPMLocation;
