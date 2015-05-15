// avoid storing passwords as plain text in config
exports.encodeCredentials = function(username, password) {
  var raw = encodeURIComponent(username) + ':' + encodeURIComponent(password);
  return new Buffer(raw).toString('base64');
}
exports.decodeCredentials = function(str) {
  var auth = new Buffer(str, 'base64').toString('ascii').split(':');
  return {
    username: decodeURIComponent(auth[0]),
    password: decodeURIComponent(auth[1])
  };
}

