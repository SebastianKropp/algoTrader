
const https = require('https')

/**
 * Do a request with options provided.
 *
 * @param {Object} options
 * @param {Object} data
 * @return {Promise} a promise of request
 */
function doRequest(options) {
    return new Promise((resolve, reject) => {
      const req = https.request(options, (res) => {
        res.setEncoding('utf8');
        let responseBody = '';
  
        res.on('data', (chunk) => {
          responseBody += chunk;
        });
  
        res.on('end', () => {
          resolve(JSON.parse(responseBody));
        });
      });
  
      req.on('error', (err) => {
        reject(err);
      });
      req.end();
    });
  }

function withTimeout(promise, timeout) {
    return Promise.race([
        promise,
        new Promise((resolve, reject) => {
        setTimeout(() => {
            reject(new Error('Timeout'));
        }, timeout);
        })
    ]);
}

function truncateDecimals(number, digits) {
    var multiplier = Math.pow(10, digits),
        adjustedNum = number * multiplier,
        truncatedNum = Math[adjustedNum < 0 ? 'ceil' : 'floor'](adjustedNum);

    return truncatedNum / multiplier;
};

module.exports = {
    doRequest,
    withTimeout,
    truncateDecimals
}