const ini = require('ini');
const path = require('path');
const fs = require('fs');

const HOME_DIR = require('os').homedir();

let initializedNpmrc = false;
let npmrc;
function safeReadSync (filePath) {
  try {
    return fs.readFileSync(filePath).toString();
  }
  catch (err) {
    if (err && err.code === 'ENOENT')
      return '';
    throw err;
  }
}
function dextend(a, b) {
  for (var p in b) {
    if (!b.hasOwnProperty(p))
      continue;
    var val = b[p];
    if (typeof val === 'object')
      dextend(a[p] = typeof a[p] === 'object' ? a[p] : {}, val);
    else
      a[p] = val;
  }
  return a;
}
function readNpmrcFiles () {
  let projectNpmrcPath = path.resolve(process.env.jspmConfigPath ? path.dirname(process.env.jspmConfigPath) : process.cwd(), '.npmrc');

  const homeNpmrcSource = safeReadSync(path.join(HOME_DIR, '.npmrc'));
  if (homeNpmrcSource)
    npmrc = ini.decode(homeNpmrcSource);
  
  const projectNpmrcSource = safeReadSync(projectNpmrcPath);
  if (projectNpmrcSource) {
    if (!npmrc)
      npmrc = ini.decode(projectNpmrcSource);
    else
      npmrc = dextend(npmrc, ini.decode(projectNpmrcSource));
  }
  else if (!npmrc)
    npmrc = {};
}

exports.get = function (name) {
  if (!initializedNpmrc)
    readNpmrcFiles();
  return npmrc[name];
};

exports.json = function () {
  if (!initializedNpmrc)
    readNpmrcFiles();
  return npmrc;
};