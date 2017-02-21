const assign = require("object-assign");
const babel = require("babel-core");
const loaderUtils = require("loader-utils");
const path = require("path");
const cache = require("./fs-cache.js");
const exists = require("./utils/exists")();
const relative = require("./utils/relative");
const read = require("./utils/read")();
const resolveRc = require("./resolve-rc.js");
const pkg = require("./../package.json");

/**
 * Error thrown by Babel formatted to conform to Webpack reporting.
 */
function BabelLoaderError(name, message, codeFrame, hideStack, error) {
  Error.call(this);
  Error.captureStackTrace(this, BabelLoaderError);

  this.name = "BabelLoaderError";
  this.message = formatMessage(name, message, codeFrame);
  this.hideStack = hideStack;
  this.error = error;
}

BabelLoaderError.prototype = Object.create(Error.prototype);
BabelLoaderError.prototype.constructor = BabelLoaderError;

const STRIP_FILENAME_RE = /^[^:]+: /;

const formatMessage = function(name, message, codeFrame) {
  return (name ? name + ": " : "") + message + "\n\n" + codeFrame + "\n";
};

const transpile = function(source, options) {
  const forceEnv = options.forceEnv;
  let tmpEnv;

  delete options.forceEnv;

  if (forceEnv) {
    tmpEnv = process.env.BABEL_ENV;
    process.env.BABEL_ENV = forceEnv;
  }

  let result;
  try {
    result = babel.transform(source, options);
  } catch (error) {
    if (forceEnv) process.env.BABEL_ENV = tmpEnv;
    if (error.message && error.codeFrame) {
      let message = error.message;
      let name;
      let hideStack;
      if (error instanceof SyntaxError) {
        message = message.replace(STRIP_FILENAME_RE, "");
        name = "SyntaxError";
        hideStack = true;
      } else if (error instanceof TypeError) {
        message = message.replace(STRIP_FILENAME_RE, "");
        hideStack = true;
      }
      throw new BabelLoaderError(
        name, message, error.codeFrame, hideStack, error);
    } else {
      throw error;
    }
  }
  const code = result.code;
  const map = result.map;

  if (map && (!map.sourcesContent || !map.sourcesContent.length)) {
    map.sourcesContent = [source];
  }

  if (forceEnv) process.env.BABEL_ENV = tmpEnv;

  return {
    code: code,
    map: map,
  };
};

module.exports = function(source, inputSourceMap) {
  // Handle filenames (#106)
  const webpackRemainingChain = loaderUtils.getRemainingRequest(this).split("!");
  const filename = webpackRemainingChain[webpackRemainingChain.length - 1];

  // Handle options
  const globalOptions = this.options.babel || {};
  const loaderOptions = loaderUtils.parseQuery(this.query);
  const userOptions = assign({}, globalOptions, loaderOptions);
  const defaultOptions = {
    inputSourceMap: inputSourceMap,
    sourceRoot: process.cwd(),
    filename: filename,
    cacheIdentifier: JSON.stringify({
      "babel-loader": pkg.version,
      "babel-core": babel.version,
      babelrc: exists(userOptions.babelrc) ?
          read(userOptions.babelrc) :
          resolveRc(path.dirname(filename)),
      env: userOptions.forceEnv || process.env.BABEL_ENV || process.env.NODE_ENV || "development",
    }),
  };

  const options = assign({}, defaultOptions, userOptions);

  if (userOptions.sourceMap === undefined) {
    options.sourceMap = this.sourceMap;
  }

  if (options.sourceFileName === undefined) {
    options.sourceFileName = relative(
      options.sourceRoot,
      options.filename
    );
  }

  const cacheDirectory = options.cacheDirectory;
  const cacheIdentifier = options.cacheIdentifier;

  delete options.cacheDirectory;
  delete options.cacheIdentifier;

  this.cacheable();

  if (cacheDirectory) {
    const callback = this.async();
    return cache({
      directory: cacheDirectory,
      identifier: cacheIdentifier,
      source: source,
      options: options,
      transform: transpile,
    }, function(err, result) {
      if (err) { return callback(err); }
      return callback(null, result.code, result.map);
    });
  }
  
  //hot fix on input source map from webpack is string rather than json
  if(options.inputSourceMap != undefined){
    options.inputSourceMap = JSON.parse(options.inputSourceMap)
  }

  const result = transpile(source, options);
  this.callback(null, result.code, result.map);
};
