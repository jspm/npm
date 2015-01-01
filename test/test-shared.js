var assert = require('assert');
var buffer = require('buffer');
var console = require('console');
var constants = require('constants');
var domain = require('domain');
var events = require('events');
var os = require('os');
var path = require('path');
var process = require('process');
var punycode = require('punycode');
var querystring = require('querystring');
// var stream = require('stream');
var string_decoder = require('string_decoder');
var timers = require('timers');
var tty = require('tty');
var url = require('url');
var util = require('util');
var zlib = require('zlib');

assert.equal(new buffer.Buffer('base64 encoded').toString('base64'), 'YmFzZTY0IGVuY29kZWQ=');
assert.equal(constants.ENOENT, 2);

var d = domain.create();
d.run(function() {

  var evt = new events.EventEmitter();
  evt.on('customEvent', function() {
    assert(os.platform());

    assert(path.join('one', 'two'), 'one' + path.sep + 'two');

    process.nextTick(function() {

      assert.equal(punycode.decode('maana-pta'), 'mañana');

      assert.equal(querystring.parse('a=b&c=d').c, 'd');

      // assert(stream.Duplex);

      var decoder = new string_decoder.StringDecoder();
      assert.equal(new buffer.Buffer([0xE2, 0x82, 0xAC]), '€');

      timers.setTimeout(function() {

        assert(tty.isatty);

        assert.equal(url.parse('some/url?asdf').pathname, 'some/url');

        assert(util.isArray([]));

        var completeMsg = 'Shared tests passed successfully.';

        if (typeof document != 'undefined')
          document.body.innerHTML = completeMsg;

        console.log(completeMsg);

      });

    });

  });
  evt.emit('customEvent');

});