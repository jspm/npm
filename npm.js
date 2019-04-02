const { URL, parse: parseUrl, format: formatUrl } = require('url');
const { Semver } = require('sver');
const npmrc = require('./npmrc');
const fs = require('fs');
const { createHash } = require('crypto');
const { Readable } = require('stream');
const { createGzip } = require('zlib');

const accept = 'application/vnd.npm.install-v1+json; q=1.0, application/json; q=0.8, */*';

module.exports = class NpmEndpoint {
  constructor (util, config) {
    this.util = util;

    this.timeout = config.timeout;
    this.strictSSL = config.strictSSL;
    this.defaultRegistryUrl = config.registry || npmrc.get('registry') || 'https://registry.npmjs.org';
    this.defaultRegistryUrlObj = new URL(this.defaultRegistryUrl);
    
    this.freshLookups = {};

    this.registryScopes = {};
    // hosts are stored like npm without protocol (//registry.npmjs.org/)
    // NB may need better host sanitization here if there are protocol variations of this
    this.registryHosts = [];
    let npmrcJson = npmrc.json();
    Object.keys(npmrcJson).forEach(key => {
      if (key[0] === '@' && key.endsWith(':registry')) {
        const value = npmrcJson[key];
        if (value[value.length - 1] === '/')
          value = value.substr(0, value.length - 1);
        if (typeof value === 'string') {
          this.registryScopes[key.substr(0, key.length - 9)] = { registryUrl: value, registryUrlObj: new URL(value) };
          if (!this.registryHosts.find(registryUrl => registryUrl === value))
            this.registryHosts.push(value.substr(value.indexOf('//')));
        }
      }
      if (key[0] === '/' && key[1] === '/') {
        const propIndex = key.lastIndexOf(':');
        if (propIndex !== -1) {
          let registryHost = key.substr(0, propIndex);
          if (registryHost[registryHost.length - 1] === '/')
            registryHost = registryHost.substr(0, registryHost.length - 1);
          if (!this.registryHosts.includes(registryHost))
            this.registryHosts.push(registryHost);
        }
      }
    });
  }

  dispose () {
  }

  async configure () {
    this.util.log.warn(`jspm support for these authorization prompts is pending.
To configure npm authentication, edit the npmrc file directly or use the npm CLI.
If npmrc configurations are not applying correctly in jspm, please post an issue at https://github.com/jspm/jspm-cli.`);
  }

  /*
   * npm npmrc authentication and credentials handler
   */
  async auth (url, method, credentials, unauthorizedHeaders) {
    // todo - input prompts to assist with reauthorization
    // pending above support
    if (unauthorizedHeaders) {
      if (unauthorizedHeaders['www-authenticate'] && unauthorizedHeaders['www-authenticate'][0] === 'OTP') {
        const otp = await this.util.input('Enter your npm OTP', {
          validate (input) {
            if (!input || input.length !== 6 || parseInt(input, 10).toString().padStart(6, '0') !== input)
              return 'The OTP code must be a valid 6 digit number.';
          }
        });
        credentials.headers = credentials.headers || {};
        credentials.headers['npm-otp'] = otp;
        return true;
      }
      this.util.log('Reauthorization for registry scopes not yet implemented. Please post an issue.');
      return false;
    }

    const host = `//${url.host}`;
    // dont auth normal registry lookups unless its a publish
    if (method !== 'PUT' &&
        !(url.origin === this.defaultRegistryUrl || url.protocol === 'https' && this.registryHosts.includes(host)))
      return false;

    if (!credentials.proxy)
      credentials.proxy = npmrc.get('https-proxy') || npmrc.get('http-proxy');
    
    if (credentials.strictSSL === undefined && npmrc.get('strict-ssl') === false)
      credentials.strictSSL = false;
    
    if (credentials.ca === undefined) {
      credentials.ca = npmrc.get(`${host}:ca`);
      if (credentials.ca === undefined)
        credentials.ca = npmrc.get('ca');
    }

    if (!credentials.ca) {
      let cafile = npmrc.get(`${host}:ca`);
      if (cafile === undefined)
        cafile = npmrc.get('cafile');
      if (cafile)
        credentials.ca = fs.readFileSync(cafile).toString();
    }

    if (!credentials.cert) {
      credentials.cert = npmrc.get(`${host}:cert`);
      if (credentials.cert === undefined)
        credentials.cert = npmrc.get('cert');
    }

    let alwaysAuth = npmrc.get(`${host}:always-auth`);
    if (alwaysAuth === undefined)
      alwaysAuth = npmrc.get('always-auth');
    
    if (alwaysAuth || method === 'PUT') {
      let authToken = npmrc.get(`${host}/:_authToken`);
      if (authToken === undefined)
        authToken = npmrc.get(`_authToken`);
      if (authToken) {
        credentials.headers = { authorization: `Bearer ${authToken}` };
      }
      // support legacy npm auth formats
      else {
        let _auth = npmrc.get(`${host}:_auth`);
        if (_auth === undefined)
          _auth = npmrc.get(`_auth`);
        if (_auth) {
          const [username, password] = new Buffer(_auth, 'base64').toString().split(':');
          credentials.basicAuth = { username, password };
        }
        else {
          let username = npmrc.get(`${host}:username`);
          if (username === undefined)
            username = npmrc.get(`username`);
          if (username) {
            let password = npmrc.get(`${host}:_password`);
            if (password === undefined)
              password = npmrc.get(`_password`);
            if (password) {
              password = new Buffer(password, 'base64').toString();
              credentials.basicAuth = { username, password };
            }
          }
        }
      }
    }

    return true;
  }

  /*
   * Resolved object has the shape:
   * { hash, source?, dependencies?, peerDependencies?, optionalDependencies?, deprecated?, override? }
   */
  async lookup (packageName, _versionRange, lookup) {
    if (this.freshLookups[packageName])
      return false;

    let { registryUrl, registryUrlObj } = this.getRegistryUrl(packageName);
    const { json, eTag } = await this.npmLookup(registryUrl, packageName, undefined, lookup.meta.eTag);
    if (!json)
      return false;

    lookup.meta.eTag = eTag;

    let resVersions = json.versions;
    Object.keys(resVersions).forEach(v => {
      lookup.versions[this.util.encodeVersion(v)] = { resolved: versionDataToResolved(resVersions[v], registryUrlObj) };
    });

    let distTags = json['dist-tags'];
    if (distTags) {
      Object.keys(distTags).forEach(tag => {
        const exactVersion = this.util.encodeVersion(distTags[tag]);
        const versionData = lookup.versions[this.util.encodeVersion(distTags[tag])];
        lookup.versions[this.util.encodeVersion(tag)] = versionData;
        versionData.resolved.version = exactVersion;
      });
    }

    this.freshLookups[packageName] = true;
    return true;
  }

  getRegistryUrl (packageName) {
    let registryUrl = this.defaultRegistryUrl;
    let registryUrlObj = this.defaultRegistryUrlObj;
    if (packageName[0] === '@') {
      const scope = packageName.substr(0, packageName.indexOf('/'));
      if (this.registryScopes[scope])
        ({ registryUrl, registryUrlObj } = this.registryScopes[scope]);
    }
    return { registryUrl, registryUrlObj };
  }

  async resolve (packageName, version, lookup) {
    if (this.freshLookups[packageName])
      return false;

    // scoped packages dont support exact version lookups on npm
    if (packageName[0] === '@')
      return this.lookup(packageName, version, lookup);
    
    let { registryUrl, registryUrlObj } = this.getRegistryUrl(packageName);

    // exact versions are immutable in npm
    const resolved = lookup.versions[version];
    if (resolved && resolved.resolved && Semver.isValid(version)) {
      // ensure that the source is set to the current registry configuration
      if (!resolved.resolved.source.startsWith(registryUrl)) {
        // update in bulk if so
        Object.keys(lookup.versions).forEach(version => {
          const resolved = lookup.versions[version].resolved;
          if (resolved)
            resolved.source = ensureSourceUrlRegistry(resolved.source, registryUrlObj);
        });
        return true;
      }
      return false;
    }
    const { json } = await this.npmLookup(registryUrl, packageName, version, undefined);
    if (!json)
      return false;
    lookup.versions[this.util.encodeVersion(version)] = {
      resolved: versionDataToResolved(json, registryUrlObj)
    };
    return true;
  }
  
  async npmLookup (registryUrl, packageName, version, eTag) {  
    let headers;
    if (eTag) {
      headers = {
        accept,
        'if-none-match': eTag
      };
    }
    else {
      headers = { accept };
    }
    try {
      var res = await this.util.fetch(`${registryUrl}/${packageName.replace('/', '%2F')}${version ? '/' + version : ''}`, { headers, timeout: this.timeout });
    }
    catch (err) {
      switch (err.code) {
        case 'ENOTFOUND':
          if (err.toString().indexOf('getaddrinfo') === -1)
            break;
        case 'ECONNRESET':
        case 'ETIMEDOUT':
        case 'ESOCKETTIMEDOUT':
          err.retriable = true;
          err.hideStack = true;
      }
      throw err;
    }
  
    switch (res.status) {
      case 200:
        break;
      case 304:
      case 404:
        return {};
      case 406:
        var e = new Error(`${this.util.highlight(packageName)} is not a valid npm package name.`);
        e.hideStack = true;
        throw e;
      case 429:
        var e = new Error(`npm has ratelimited the lookup request. You may need to use authorization.`);
        e.hideStack = true;
        throw e;
      case 401:
        var e = new Error(`Unauthorized response looking up ${this.util.bold(packageName)}.`);
        e.hideStack = true;
        throw e;
      default:
        var e = new Error(`Invalid status code ${this.util.bold(res.status)} looking up ${this.util.highlight(packageName)}. ${res.statusText}`);
        e.hideStack = true;
        throw e;
    }
  
    try {
      return {
        json: await res.json(),
        eTag: res.headers.get('etag')
      };
    }
    catch (e) {
      throw `Unable to parse lookup response for ${packageName}.`;
    }
  }
  async publish (packagePath, pjson, tarStream, { access, tag, otp }) {
    const { readme, description } = await getReadmeDescription(packagePath, pjson);

    const { registryUrl, registryUrlObj } = this.getRegistryUrl(pjson.name);

    // npm doesn't support chunked transfer!
    const chunks = [];
    for await (const chunk of createPublishStream.call(this, pjson, tarStream, { readme, description, tag, access, registryUrlObj })) {
      chunks.push(chunk);
    }
    const body = Buffer.concat(chunks);

    const headers = {
      accept,
      'content-type': 'application/json',
    };

    if (otp)
      headers['npm-otp'] = otp;

    const request = this.util.fetch(`${registryUrl}/${pjson.name.replace('/', '%2F')}`, {
      method: 'PUT',
      headers,
      timeout: this.timeout,
      body
    });
  
    try {
      var res = await request;
    }
    catch (err) {
      switch (err.code) {
        case 'ENOTFOUND':
          if (err.toString().indexOf('getaddrinfo') === -1)
            break;
        case 'ECONNRESET':
        case 'ETIMEDOUT':
        case 'ESOCKETTIMEDOUT':
          err.retriable = true;
          err.hideStack = true;
      }
      throw err;
    }
  
    switch (res.status) {
      case 200:
        break;
      case 304:
      case 404:
        return {};
      case 406:
        var e = new Error(`${this.util.highlight(pjson.name)} is not a valid npm package name.`);
        e.hideStack = true;
        throw e;
      case 429:
        var e = new Error(`npm has ratelimited the publish request. You may need to use different authorization.`);
        e.hideStack = true;
        throw e;
      case 401:
        if (res.headers.get('www-authenticate') === 'OTP')
          var e = new Error(`Invalid npm OTP provided.`);
        else
          var e = new Error(`Invalid authorization details provided.`);
        e.hideStack = true;
        throw e;
      case 403:
        try {
          var info = await res.json();
        }
        catch (e) {}
        if (info && info.error) {
          var e = new Error(`Error publishing ${this.util.bold(pjson.name)}. ${info.error}`);
          e.hideStack = true;
          throw e;
        }
        var e = new Error(`Provided credentials are forbidden from publishing ${this.util.bold(pjson.name)}. Ensure you have publish access for this package.`);
        e.hideStack = true;
        throw e;
      default:
        var e = new Error(`Invalid status code ${this.util.bold(res.status)} looking up ${this.util.highlight(pjson.name)}. ${res.statusText}`);
        e.hideStack = true;
        throw e;
    }
  }
}
// Forcing protocol and port matching for tarballs on the same host as the
// registry is taken from npm at
// https://github.com/npm/npm/blob/50ce116baac8b6877434ace471104ec8587bab90/lib/cache/add-named.js#L196-L208
function ensureSourceUrlRegistry (sourceUrl, registryUrlObj) {
  const parsed = parseUrl(sourceUrl);
  if (parsed.hostname !== registryUrlObj.hostname || parsed.protocol !== registryUrlObj.protocol) {
    parsed.protocol = registryUrlObj.protocol;
    parsed.port = registryUrlObj.port;
    return formatUrl(parsed);
  }
  return sourceUrl;
}

function versionDataToResolved (vObj, registryUrlObj) {
  let override;
  if (vObj.dependencies || vObj.peerDependencies || vObj.optionalDependencies) {
    override = { dependencies, peerDependencies, optionalDependencies } = vObj;

    // for some mysterious reason, npm copies optionalDependencies into dependencies
    if (override.optionalDependencies) {
      for (let name in override.optionalDependencies) {
        if (override.dependencies[name])
          delete override.dependencies[name];
      }
    }
  }

  const sourceUrl = ensureSourceUrlRegistry(vObj.dist.tarball, registryUrlObj);

  return {
    source: sourceUrl + '#' + (vObj.dist.integrity || vObj.dist.shasum),
    override,
    deprecated: vObj.deprecated
  };
}

function getReadmeDescription (packagePath, pjson) {
  return 'readme';
}

async function* createPublishStream (pjson, tarStream, { readme, description, tag, access, registryUrlObj }) {
  const compressedStream = createGzip();
  tarStream.pipe(compressedStream);

  const ssri = require('ssri');
  const tarURL = new URL(`${pjson.name}/-/${pjson.name}-${pjson.version}.tgz`, registryUrlObj);
  tarURL.protocol = 'http';
  tarURL.port = '';

  const shaHash = createHash('sha1');
  const ssriHash = ssri.create();
  // this.ssriStream = crypto.c
  firstRead = false;
  yield Buffer.from(JSON.stringify({
    _id: pjson.name,
    access,
    name: pjson.name,
    description,
    'dist-tags': {
      [tag || 'latest']: pjson.version,
    },
    readme,
    _attachments: {
      [`${pjson.name}-${pjson.version}.tgz`]: {
        content_type: 'application/octet-stream'
      }
    }
  }).slice(0, -3) + ',"data":"');

  // push the base64 encoding of tarStream
  let bufferLength = 0;
  let extraBytes = null;
  for await (let chunk of compressedStream) {
    shaHash.update(chunk);
    ssriHash.update(chunk);
    
    if (extraBytes) {
      chunk = Buffer.concat([extraBytes, chunk]);
      extraBytes = null;
    }
    const remaining = chunk.length % 3;
    if (remaining !== 0) {
      extraBytes = chunk.slice(chunk.length - remaining);
      chunk = chunk.slice(0, chunk.length - remaining);
    }
    const base64 = Buffer.from(chunk.toString('base64'));
    bufferLength += base64.length;
    yield base64;
  }
  if (extraBytes) {
    const base64 = Buffer.from(extraBytes.toString('base64'));
    bufferLength += base64.length;
    yield base64;
  }
  yield Buffer.from(`","length":${bufferLength.toString()}}},"versions":${JSON.stringify({
    [pjson.version]: Object.assign({}, pjson, {
      _id: `${pjson.name}@${pjson.version}`,
      dist: Object.assign(pjson.dist || {}, {
        tarball: tarURL.href,
        shasum: shaHash.digest('hex'),
        integrity: ssriHash.digest().toString()
      })
    })
  })}}`);
}

function toReadable (iterator, opts) {
  const readable = new Readable(opts);
  readable._read = next;
  function onError (err) {
    readable.destroy(err);
  }
  let curNext;
  async function next () {
    if (curNext) return curNext;
    curNext = iterator.next();
    curNext.catch(onError);
    const { value, done } = await curNext;
    curNext = null;
    if (done) {
      readable.push(null);
      return;
    }
    if (readable.push(value)) {
      await next();
    }
  }
  return readable;
}