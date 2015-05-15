var asp = require('rsvp').denodeify;
var fs = require('graceful-fs');
var path = require('path');
var utils = require('./utils');

function getFilepath() {
  var home = process.env.HOME || process.env.USERPROFILE || process.env.HOMEPATH;
  return path.resolve(home, '.npmrc');
}

function getOptionExact(contents, key) {
  var regex = new RegExp("^" + key + " ?= ?(.+)");
  var result = contents.match(regex);

  return result && result[1];
}

function getOption(contents, key, registry) {
  if (!contents)
    return;

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
  this.content = safeRead(getFilepath());
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
