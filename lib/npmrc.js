var asp = require('rsvp').denodeify;
var fs = require('graceful-fs');
var path = require('path');
var utils = require('./utils');

function getFilepath() {
  var home = process.env.HOME || process.env.USERPROFILE || process.env.HOMEPATH;
  return path.resolve(home, '.npmrc');
}

function getOption(contents, key) {
  if (!contents)
    return;

  var regex = new RegExp(key + " ?= ?(.+)");
  var result = contents.match(regex);

  return result && result[1];
}

function safeRead(filepath) {
  if (fs.existsSync(filepath))
    return fs.readFileSync(filepath).toString();
}

function Npmrc () {}

Npmrc.prototype.exists = function() {
  return fs.existsSync(getFilepath());
};

Npmrc.prototype.init = function() {
  this.content = safeRead(getFilepath());
  this.initialized = true;
};

Npmrc.prototype.getAuth = function() {
  if (!this.initialized)
    this.init();

  var auth = getOption(this.contents, "_auth");
  if (auth)
    return auth;
};

Npmrc.prototype.getRegistry = function() {
  if (!this.initialized)
    this.init();

  return getOption(this.contents, "registry");
};

module.exports = Npmrc;
