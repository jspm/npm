var expect = require('unexpected');
var auth = require('../lib/auth');
var _ = require('lodash');

describe('lib/auth', function () {
    describe('encoded credentials', function () {
        it('should encode a set of credentials', function () {
            var encodedCredentials = auth.encodeCredentials({
                username: 'foo',
                password: 'bar'
            });
            return expect(encodedCredentials, 'to equal', 'Zm9vOmJhcg==');
        });
        it('should decode a set of credentials', function () {
            var decodedCredentials = auth.decodeCredentials('Zm9vOmJhcg==');
            return expect(decodedCredentials, 'to equal', {
                username: 'foo',
                password: 'bar'
            })
        });
    })
    describe('injectRequestOptions', function () {
        var baseRequestOptions = {
            url: 'https://registry.npmjs.org/'
        };
        var requestOptions;
        beforeEach(function () {
            requestOptions = _.extend({}, baseRequestOptions);
        });
        it('should return request options if no auth options are given', function () {
            requestOptions = auth.injectRequestOptions(requestOptions);
            return expect(requestOptions, 'to equal', baseRequestOptions);
        });
        it('should return request options if empty auth options are given', function () {
            requestOptions = auth.injectRequestOptions(requestOptions, {});
            return expect(requestOptions, 'to equal', baseRequestOptions);
        });
        it('should inject BasicAuth options into request options', function () {
            requestOptions = auth.injectRequestOptions(requestOptions, {
                username: 'foo',
                password: 'bar'
            })
            return expect(requestOptions, 'to satisfy', {
                auth: {
                    user: 'foo',
                    pass: 'bar'
                }
            });
        });
        it('should inject auth tokens into request options', function () {
            requestOptions = auth.injectRequestOptions(requestOptions, {
                token: 'foobar'
            })
            return expect(requestOptions, 'to satisfy', {
                headers: {
                    authorization: 'Bearer foobar'
                }
            });
        });
        it('should inject auth tokens into request options with existing headers', function () {
            requestOptions.headers = {
                'X-Custom-Header': 'helloworld'
            };
            requestOptions = auth.injectRequestOptions(requestOptions, {
                token: 'foobar'
            })
            return expect(requestOptions, 'to satisfy', {
                headers: {
                    'X-Custom-Header': 'helloworld',
                    authorization: 'Bearer foobar'
                }
            });
        });
    });
    describe('configureCredentials', function () {

    });
});
