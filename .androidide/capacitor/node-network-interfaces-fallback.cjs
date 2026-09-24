const os = require('os');
const nativeProcessBinding = process.binding;
const originalNetworkInterfaces = os.networkInterfaces;
os.networkInterfaces = function networkInterfacesWithAndroidFallback() {
  try {
    return originalNetworkInterfaces.call(os);
  } catch (error) {
    if (error && (error.code === 'ERR_SYSTEM_ERROR' || error.errno === 13)) {
      return {
        lo: [
          {
            address: '127.0.0.1',
            netmask: '255.0.0.0',
            family: 'IPv4',
            mac: '00:00:00:00:00:00',
            internal: true,
            cidr: '127.0.0.1/8'
          },
          {
            address: '::1',
            netmask: 'ffff:ffff:ffff:ffff:ffff:ffff:ffff:ffff',
            family: 'IPv6',
            mac: '00:00:00:00:00:00',
            internal: true,
            cidr: '::1/128',
            scopeid: 0
          }
        ]
      };
    }
    throw error;
  }
};

// websocket-driver <= 0.6 calls process.binding('http_parser'),
// which was removed from modern Node.js releases. Vue CLI 3/4
// can still resolve that driver through faye-websocket. Keep
// the compatibility path local to this Web process and only
// provide the small HTTP/1.x parser surface it needs for the
// WebSocket handshake.
let fallbackHttpParser;
function createHttpParserBinding() {
  const Buffer = require('buffer').Buffer;
  class HttpParser {
    constructor(type) {
      this.type = type;
      this.pending = Buffer.alloc(0);
    }

    execute(chunk, offset, length) {
      const input = Buffer.isBuffer(chunk)
        ? chunk.slice(offset, offset + length)
        : Buffer.from(chunk).slice(offset, offset + length);
      const previousLength = this.pending.length;
      this.pending = Buffer.concat([this.pending, input]);
      const marker = Buffer.from('\r\n\r\n');
      const headerEnd = this.pending.indexOf(marker);
      if (headerEnd < 0) return length;

      const headerText = this.pending.slice(0, headerEnd).toString('latin1');
      const lines = headerText.split('\r\n');
      const startLine = lines.shift() || '';
      const headers = [];
      for (const line of lines) {
        const separator = line.indexOf(':');
        if (separator <= 0) continue;
        headers.push(
          line.slice(0, separator).trim(),
          line.slice(separator + 1).trim()
        );
      }

      const info = { headers };
      if (this.type === HttpParser.REQUEST || this.type === 'request') {
        const request = startLine.match(/^[^\s]+\s+([^\s]+)(?:\s+HTTP\/\d(?:\.\d)?)?$/);
        info.method = startLine.split(/\s+/, 1)[0];
        info.url = request ? request[1] : '/';
      } else {
        const response = startLine.match(/^HTTP\/\d(?:\.\d)?\s+(\d{3})/);
        info.statusCode = response ? Number(response[1]) : 0;
      }

      const callback = this[HttpParser.kOnHeadersComplete] || this.onHeadersComplete;
      if (typeof callback === 'function') callback.call(this, info);

      this.pending = Buffer.alloc(0);
      return Math.max(0, Math.min(length, headerEnd + marker.length - previousLength));
    }
  }

  HttpParser.REQUEST = 'request';
  HttpParser.RESPONSE = 'response';
  HttpParser.kOnHeadersComplete = 'onHeadersComplete';
  return { HTTPParser: HttpParser };
}

process.binding = function androidCompatibleProcessBinding(name) {
  if (name === 'http_parser') {
    try {
      return nativeProcessBinding.call(process, name);
    } catch (error) {
      if (!fallbackHttpParser) fallbackHttpParser = createHttpParserBinding();
      return fallbackHttpParser;
    }
  }
  return nativeProcessBinding.apply(process, arguments);
};