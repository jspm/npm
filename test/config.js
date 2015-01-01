System.config({
  "paths": {
    "*": "*.js",
    "app/*": "lib/*.js",
    "github:*": "jspm_packages/github/*.js",
    "npm:*": "jspm_packages/npm/*.js"
  }
});

System.config({
  "map": {
    "assert": "github:jspm/nodelibs-assert@0.1.0",
    "buffer": "github:jspm/nodelibs-buffer@0.1.0",
    "child_process": "github:jspm/nodelibs-child_process@0.1.0",
    "cluster": "github:jspm/nodelibs-cluster@0.1.0",
    "console": "github:jspm/nodelibs-console@0.1.0",
    "constants": "github:jspm/nodelibs-constants@0.1.0",
    "dgram": "github:jspm/nodelibs-dgram@0.1.0",
    "dns": "github:jspm/nodelibs-dns@0.1.0",
    "domain": "github:jspm/nodelibs-domain@0.1.0",
    "events": "github:jspm/nodelibs-events@0.1.0",
    "net": "github:jspm/nodelibs-net@0.1.0",
    "os": "github:jspm/nodelibs-os@0.1.0",
    "path": "github:jspm/nodelibs-path@0.1.0",
    "process": "npm:process@0.10.0",
    "punycode": "github:jspm/nodelibs-punycode@0.1.0",
    "querystring": "github:jspm/nodelibs-querystring@0.1.0",
    "readline": "github:jspm/nodelibs-readline@0.1.0",
    "repl": "github:jspm/nodelibs-repl@0.1.0",
    "stream": "github:jspm/nodelibs-stream@0.1.0",
    "string_decoder": "github:jspm/nodelibs-string_decoder@0.1.0",
    "timers": "github:jspm/nodelibs-timers@0.1.0",
    "tls": "github:jspm/nodelibs-tls@0.1.0",
    "tty": "github:jspm/nodelibs-tty@0.1.0",
    "url": "github:jspm/nodelibs-url@0.1.0",
    "util": "github:jspm/nodelibs-util@0.1.0",
    "zlib": "github:jspm/nodelibs-zlib@0.1.0",
    "github:jspm/nodelibs-assert@0.1.0": {
      "assert": "npm:assert@1.3.0"
    },
    "github:jspm/nodelibs-buffer@0.1.0": {
      "buffer": "npm:buffer@3.0.1"
    },
    "github:jspm/nodelibs-console@0.1.0": {
      "console-browserify": "npm:console-browserify@1.1.0"
    },
    "github:jspm/nodelibs-constants@0.1.0": {
      "constants-browserify": "npm:constants-browserify@0.0.1",
      "systemjs-json": "github:systemjs/plugin-json@0.1.0"
    },
    "github:jspm/nodelibs-dgram@0.1.0": {
      "systemjs-json": "github:systemjs/plugin-json@0.1.0"
    },
    "github:jspm/nodelibs-dns@0.1.0": {
      "systemjs-json": "github:systemjs/plugin-json@0.1.0"
    },
    "github:jspm/nodelibs-domain@0.1.0": {
      "domain-browser": "npm:domain-browser@1.1.3"
    },
    "github:jspm/nodelibs-events@0.1.0": {
      "events-browserify": "npm:events-browserify@0.0.1"
    },
    "github:jspm/nodelibs-fs@0.1.0": {
      "assert": "npm:assert@1.3.0",
      "fs": "github:jspm/nodelibs-fs@0.1.0"
    },
    "github:jspm/nodelibs-net@0.1.0": {
      "systemjs-json": "github:systemjs/plugin-json@0.1.0"
    },
    "github:jspm/nodelibs-os@0.1.0": {
      "os-browserify": "npm:os-browserify@0.1.2"
    },
    "github:jspm/nodelibs-path@0.1.0": {
      "path-browserify": "npm:path-browserify@0.0.0"
    },
    "github:jspm/nodelibs-process@0.1.0": {
      "process": "npm:process@0.10.0"
    },
    "github:jspm/nodelibs-punycode@0.1.0": {
      "punycode": "npm:punycode@1.3.2"
    },
    "github:jspm/nodelibs-querystring@0.1.0": {
      "querystring": "npm:querystring@0.2.0"
    },
    "github:jspm/nodelibs-readline@0.1.0": {
      "systemjs-json": "github:systemjs/plugin-json@0.1.0"
    },
    "github:jspm/nodelibs-repl@0.1.0": {
      "systemjs-json": "github:systemjs/plugin-json@0.1.0"
    },
    "github:jspm/nodelibs-stream@0.1.0": {
      "stream-browserify": "npm:stream-browserify@1.0.0"
    },
    "github:jspm/nodelibs-string_decoder@0.1.0": {
      "string_decoder": "npm:string_decoder@0.10.31"
    },
    "github:jspm/nodelibs-timers@0.1.0": {
      "timers-browserify": "npm:timers-browserify@1.1.0"
    },
    "github:jspm/nodelibs-tls@0.1.0": {
      "systemjs-json": "github:systemjs/plugin-json@0.1.0"
    },
    "github:jspm/nodelibs-tty@0.1.0": {
      "tty-browserify": "npm:tty-browserify@0.0.0"
    },
    "github:jspm/nodelibs-url@0.1.0": {
      "url": "npm:url@0.10.1"
    },
    "github:jspm/nodelibs-util@0.1.0": {
      "util": "npm:util@0.10.3"
    },
    "github:jspm/nodelibs-zlib@0.1.0": {
      "browserify-zlib": "npm:browserify-zlib@0.1.4"
    },
    "npm:assert@1.3.0": {
      "util": "npm:util@0.10.3"
    },
    "npm:browserify-zlib@0.1.4": {
      "assert": "github:jspm/nodelibs-assert@0.1.0",
      "buffer": "github:jspm/nodelibs-buffer@0.1.0",
      "pako": "npm:pako@0.2.5",
      "process": "github:jspm/nodelibs-process@0.1.0",
      "util": "github:jspm/nodelibs-util@0.1.0"
    },
    "npm:buffer@3.0.1": {
      "base64-js": "npm:base64-js@0.0.8",
      "ieee754": "npm:ieee754@1.1.4",
      "is-array": "npm:is-array@1.0.1"
    },
    "npm:console-browserify@1.1.0": {
      "assert": "github:jspm/nodelibs-assert@0.1.0",
      "date-now": "npm:date-now@0.1.4",
      "util": "github:jspm/nodelibs-util@0.1.0"
    },
    "npm:constants-browserify@0.0.1": {
      "systemjs-json": "github:systemjs/plugin-json@0.1.0"
    },
    "npm:core-util-is@1.0.1": {
      "buffer": "github:jspm/nodelibs-buffer@0.1.0"
    },
    "npm:domain-browser@1.1.3": {
      "events": "github:jspm/nodelibs-events@0.1.0"
    },
    "npm:events-browserify@0.0.1": {
      "process": "github:jspm/nodelibs-process@0.1.0"
    },
    "npm:inherits@2.0.1": {
      "util": "github:jspm/nodelibs-util@0.1.0"
    },
    "npm:os-browserify@0.1.2": {
      "os": "github:jspm/nodelibs-os@0.1.0"
    },
    "npm:pako@0.2.5": {
      "buffer": "github:jspm/nodelibs-buffer@0.1.0",
      "fs": "github:jspm/nodelibs-fs@0.1.0",
      "path": "github:jspm/nodelibs-path@0.1.0",
      "process": "github:jspm/nodelibs-process@0.1.0",
      "util": "github:jspm/nodelibs-util@0.1.0",
      "zlib": "github:jspm/nodelibs-zlib@0.1.0"
    },
    "npm:path-browserify@0.0.0": {
      "jspm-nodelibs-process": "github:jspm/nodelibs-process@0.1.0"
    },
    "npm:punycode@1.3.2": {
      "process": "github:jspm/nodelibs-process@0.1.0"
    },
    "npm:readable-stream@1.1.13": {
      "buffer": "github:jspm/nodelibs-buffer@0.1.0",
      "core-util-is": "npm:core-util-is@1.0.1",
      "events": "github:jspm/nodelibs-events@0.1.0",
      "inherits": "npm:inherits@2.0.1",
      "isarray": "npm:isarray@0.0.1",
      "process": "github:jspm/nodelibs-process@0.1.0",
      "stream": "github:jspm/nodelibs-stream@0.1.0",
      "string_decoder": "npm:string_decoder@0.10.31",
      "util": "github:jspm/nodelibs-util@0.1.0"
    },
    "npm:stream-browserify@1.0.0": {
      "events": "github:jspm/nodelibs-events@0.1.0",
      "inherits": "npm:inherits@2.0.1",
      "readable-stream": "npm:readable-stream@1.1.13"
    },
    "npm:string_decoder@0.10.31": {
      "buffer": "github:jspm/nodelibs-buffer@0.1.0"
    },
    "npm:timers-browserify@1.1.0": {
      "process": "npm:process@0.10.0"
    },
    "npm:url@0.10.1": {
      "assert": "github:jspm/nodelibs-assert@0.1.0",
      "punycode": "npm:punycode@1.3.2",
      "querystring": "github:jspm/nodelibs-querystring@0.1.0",
      "util": "github:jspm/nodelibs-util@0.1.0"
    },
    "npm:util@0.10.3": {
      "inherits": "npm:inherits@2.0.1",
      "process": "github:jspm/nodelibs-process@0.1.0"
    }
  }
});

