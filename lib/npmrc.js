var asp = require('rsvp').denodeify;
var fs = require('graceful-fs');
var path = require('path');
var utils = require('./utils');
var which = require('which');

function getFilepaths() {
  var home = process.env.HOME || process.env.USERPROFILE || process.env.HOMEPATH;
  var paths = ['.npmrc', path.resolve(home, '.npmrc')];

  var prefix = process.env.PREFIX;
  if (prefix)
    paths.push(path.resolve(prefix, 'npmrc'));

  var releaseSettings;
  try {
    var execPath = which.sync('npm');
    if (fs.lstatSync(execPath).isSymbolicLink())
      execPath = fs.readlinkSync(execPath);
    releaseSettings = path.resolve(path.dirname(execPath), '../npmrc');
  }
  catch (e) {}
  if (releaseSettings)
    paths.push(releaseSettings);

  return paths;
}

function getOptionExact(contents, key) {
  var regex = new RegExp("^" + key + " ?= ?(.+)");
  var result;
  for (var i=0; i<=contents.length; i++) {
    var content = contents[i];
    result = content && content.match(regex);
    if (result) break;
  }
  return result && result[1];
}

function getOption(contents, key, registry) {
  if (registry) {
    var prefix = registry.replace(/^.+:/, '') + '/' ;
    return getOptionExact(contents, prefix + key) ||
           getOptionExact(contents, key);
  }
  else
    return getOptionExact(contents, key);
}

function safeRead(filepath) {
  if (fs.existsSync(filepath))
    return fs.readFileSync(filepath).toString();
}

function Npmrc () {}

Npmrc.prototype.init = function() {
  this.contents = getFilepaths().map(safeRead);
  this.initialized = true;
};

Npmrc.prototype.getAuth = function(registry) {
  if (!registry)
    registry = this.getRegistry();

  if (!this.initialized)
    this.init();

  var auth = getOption(this.contents, "_auth", registry);
  if (auth)
    return auth;

  var username = getOption(this.contents, "username", registry);
  var password = getOption(this.contents, "_password", registry);
  if (username && password)
    return utils.encodeCredentials(username, password);
};

Npmrc.prototype.getRegistry = function() {
  if (!this.initialized)
    this.init();

  return getOption(this.contents, "registry");
};

module.exports = Npmrc;
