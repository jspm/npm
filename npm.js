const { URL, parse: parseUrl, format: formatUrl } = require('url');
const { Semver, SemverRange, semverRegEx } = require('sver');
const convertRange = require('sver/convert-range');
const npmrc = require('./npmrc');
const fs = require('fs');

const accept = 'application/vnd.npm.install-v1+json';
const scopeRegistryRegEx = /^@.+\:registry$/;

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
    this.util.ui.warn(`jspm support for these authorization prompts is pending.
To configure npm authentication, edit the npmrc file directly or use the npm CLI.
If npmrc configurations are not applying correctly in jspm, please post an issue at https://github.com/jspm/jspm-cli.`);
  }

  /*
   * npm npmrc authentication and credentials handler
   */
  async auth (url, credentials, unauthorized) {
    // todo - input prompts to assist with reauthorization
    // pending above support
    if (unauthorized)
      return;

    const host = `//${url.host}`;
    if (!(url.origin === this.defaultRegistryUrl || url.protocol === 'https' && this.registryHosts.includes(host)))
      return false;
    
    // NB do proxy, and strictSSL scope to individual registries as well?
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
    
    if (alwaysAuth) {
      let authToken = npmrc.get(`${host}:_authToken`);
      if (authToken === undefined)
        authToken = npmrc.get(`_authToken`);
      if (authToken) {
        credentials.authorization = `Bearer ${authToken}`;
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
  async lookup (packageName, versionRange, lookup) {
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
        var e = new Error(`Invalid status code ${this.util.bold(res.status)} looking up ${this.util.highlight(packageName)}.`);
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